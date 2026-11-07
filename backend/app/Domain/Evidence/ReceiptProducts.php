<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use Illuminate\Support\Str;

class ReceiptProducts
{
    public const array CATEGORIES = ['produce', 'meat_fish', 'dairy', 'deli', 'pantry', 'bakery', 'prepared', 'beverages', 'cleaning', 'personal_care', 'pets', 'other'];

    public function __construct(private LedgerRepository $repository) {}

    public function latest(string $table, string $key, string|int $id): ?array
    {
        $row = $this->repository->query($table)->where($key, $id)->orderByDesc('seq')->first();

        return $row === null ? null : [...json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR), 'seq' => (int) $row->seq];
    }

    public function current(string $table, string $key = 'id'): array
    {
        $rows = $this->repository->query($table)->orderBy('seq')->get();
        $values = [];
        foreach ($rows as $row) {
            $values[$row->$key] = [...json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR), 'seq' => (int) $row->seq];
        }

        return array_values($values);
    }

    public function product(string $id): array
    {
        $value = $this->latest('product_revisions', 'product_id', $id);
        if ($value === null) {
            throw new AccountingError('missing_review_subject');
        }

        return $value;
    }

    private function appendProduct(array $value): void
    {
        unset($value['seq']);
        $this->repository->insert('product_revisions', ['product_id' => $value['id'], 'redirect_id' => $value['redirectId'], 'payload' => LedgerRepository::json($value)]);
    }

    public function appendMatch(array $match): void
    {
        unset($match['seq']);
        $this->repository->insert('product_match_revisions', ['id' => $match['id'], 'product_id' => $match['productId'], 'payload' => LedgerRepository::json($match)]);
    }

    private function appendCode(array $code): void
    {
        unset($code['seq']);
        $this->repository->insert('product_code_revisions', ['id' => $code['id'], 'product_id' => $code['productId'], 'payload' => LedgerRepository::json($code)]);
    }

    public function matchReceipt(string $revision, bool $rematch = false): void
    {
        foreach ($this->repository->query('source_lines')->where('revision_id', $revision)->orderBy('occurrence')->get() as $line) {
            if (! $rematch && $this->latest('product_match_revisions', 'id', $line->id) !== null) {
                continue;
            }
            $item = json_decode($line->payload, true, flags: JSON_THROW_ON_ERROR);
            $codeId = isset($item['sku']) ? LedgerRepository::json(['coto', $item['sku']]) : null;
            $code = $codeId === null ? null : $this->latest('product_code_revisions', 'id', $codeId);
            $productId = $code['productId'] ?? null;
            $method = $code === null ? 'auto' : 'code';
            if ($productId === null) {
                $rules = $this->current('product_rule_revisions');
                usort($rules, fn ($a, $b) => ($a['position'] <=> $b['position']) ?: strcmp($a['id'], $b['id']));
                foreach ($rules as $rule) {
                    if (($rule['enabled'] ?? true) && $rule['chain'] === 'coto' && str_contains(mb_strtoupper($item['descPrinted']), mb_strtoupper($rule['match']))) {
                        $productId = $rule['productId'];
                        $method = 'rule';
                        break;
                    }
                }
            }
            if ($productId === null) {
                $rowId = Str::uuid()->toString();
                $this->repository->insert('review_products', ['row_id' => $rowId]);
                $productId = (string) $this->repository->query('review_products')->where('row_id', $rowId)->value('id');
                $this->appendProduct(['id' => $productId, 'name' => trim($item['descPrinted']), 'category' => 'other', 'unit' => $item['unit'], 'reviewed' => false, 'redirectId' => null]);
            }
            $product = $this->product((string) $productId);
            $seen = [];
            while ($product['redirectId'] !== null) {
                if (isset($seen[$product['id']])) {
                    throw new AccountingError('product_redirect_cycle');
                }
                $seen[$product['id']] = true;
                $product = $this->product($product['redirectId']);
            }
            $productId = $product['id'];
            if ($codeId !== null && $code === null) {
                $this->appendCode(['id' => $codeId, 'chain' => 'coto', 'sku' => $item['sku'], 'productId' => $productId, 'ean' => $item['ean'] ?? null]);
            }
            $this->appendMatch(['id' => $line->id, 'receiptRevisionId' => $revision, 'sourceLineId' => $line->id, 'productId' => $productId, 'method' => $method, 'reviewed' => false]);
        }
    }

    public function fingerprint(): string
    {
        return FinancialCommands::digest(['products' => $this->current('product_revisions', 'product_id'), 'codes' => $this->current('product_code_revisions'), 'rules' => $this->current('product_rule_revisions'), 'matches' => $this->current('product_match_revisions')]);
    }

    public function decide(array $input): array
    {
        return $this->repository->transaction(function () use ($input) {
            $key = 'review:'.$input['key'];
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->payload, true, flags: JSON_THROW_ON_ERROR)['result'], 'duplicate' => true];
            }
            $affected = [];
            $audit = [];
            $payload = $input['payload'];
            $subject = $input['subjectId'];
            if ($input['kind'] === 'product_update') {
                $product = $this->product($subject);
                if ($product['redirectId'] !== null || trim($payload['name']) === '' || mb_strlen($payload['name']) > 300 || ! in_array($payload['category'], self::CATEGORIES, true) || ! in_array($payload['unit'], ['un', 'kg'], true)) {
                    throw new AccountingError('invalid_review_payload');
                }
                if (isset($input['expectedSeq']) && $product['seq'] !== $input['expectedSeq']) {
                    throw new AccountingError('stale_review_version');
                }
                $this->appendProduct([...$product, 'name' => trim($payload['name']), 'category' => $payload['category'], 'unit' => $payload['unit'], 'reviewed' => true]);
                $affected[] = $subject;
                foreach ($this->current('product_match_revisions') as $match) {
                    if ($match['productId'] === $subject) {
                        $this->appendMatch([...$match, 'reviewed' => false]);
                        $affected[] = $match['id'];
                    }
                }
            } elseif ($input['kind'] === 'product_match') {
                $match = $this->latest('product_match_revisions', 'id', $subject);
                if ($match === null) {
                    throw new AccountingError('missing_review_subject');
                }
                if (isset($input['expectedSeq']) && $match['seq'] !== $input['expectedSeq']) {
                    throw new AccountingError('stale_review_version');
                }
                $product = $this->product($payload['productId'] ?? $match['productId']);
                if (! $product['reviewed'] || $product['redirectId'] !== null) {
                    throw new AccountingError('product_identity_unreviewed');
                }
                $line = json_decode($this->repository->query('source_lines')->where('id', $subject)->value('payload'), true);
                $correction = [];
                if ($line['unit'] !== $product['unit']) {
                    $code = isset($line['sku']) ? $this->latest('product_code_revisions', 'id', LedgerRepository::json(['coto', $line['sku']])) : null;
                    $packaged = '/(?:PAQ|CJA)\\s*\\d+(?:[.,]\\d+)?\\s*KGM?\\b/i';
                    $description = preg_replace($packaged, '', $line['descPrinted']);
                    if ($line['unit'] !== 'kg' || $product['unit'] !== 'un' || ! is_int($line['qtyMilli']) || $line['qtyMilli'] <= 0 || $line['qtyMilli'] % 1000 !== 0 || ! preg_match('/^\\d{12,14}$/D', $line['ean'] ?? '') || preg_match('/^0?2/', $line['ean']) || ($code['productId'] ?? null) !== $product['id'] || ! preg_match($packaged, $line['descPrinted']) || preg_match('/X\\s?KG\\b|XKG|\\bKGM\\b/', $description)) {
                        throw new AccountingError('product_unit_mismatch');
                    }
                    $correction = ['unitCorrection' => ['from' => 'kg', 'to' => 'un', 'reason' => 'packaged_mass']];
                    $audit = $correction;
                }
                $this->appendMatch([...$match, ...$correction, 'productId' => $product['id'], 'method' => 'manual', 'reviewed' => true]);
                $affected[] = $subject;
            } elseif ($input['kind'] === 'move_code' || $input['kind'] === 'product_merge') {
                $target = $this->product($payload['targetId']);
                if ($target['redirectId'] !== null) {
                    throw new AccountingError('invalid_product_merge');
                }
                $code = $input['kind'] === 'move_code' ? $this->latest('product_code_revisions', 'id', $subject) : null;
                if ($input['kind'] === 'move_code' && $code === null) {
                    throw new AccountingError('missing_review_subject');
                }
                $source = $this->product($code['productId'] ?? $subject);
                if (isset($input['expectedSeq']) && ($code['seq'] ?? $source['seq']) !== $input['expectedSeq']) {
                    throw new AccountingError('stale_review_version');
                }
                if ($source['id'] === $target['id'] || $source['redirectId'] !== null) {
                    throw new AccountingError('invalid_product_merge');
                }
                if ($code !== null) {
                    $this->appendCode([...$code, 'productId' => $target['id']]);
                } else {
                    $this->appendProduct([...$source, 'redirectId' => $target['id']]);
                    foreach ($this->current('product_code_revisions') as $row) {
                        if ($row['productId'] === $source['id']) {
                            $this->appendCode([...$row, 'productId' => $target['id']]);
                        }
                    }
                    foreach ($this->current('product_rule_revisions') as $row) {
                        if ($row['productId'] === $source['id']) {
                            unset($row['seq']);
                            $row['productId'] = $target['id'];
                            $this->repository->insert('product_rule_revisions', ['id' => $row['id'], 'product_id' => $target['id'], 'payload' => LedgerRepository::json($row)]);
                        }
                    }
                }
                foreach ($this->current('product_match_revisions') as $match) {
                    if ($match['productId'] !== $source['id']) {
                        continue;
                    }
                    $line = json_decode($this->repository->query('source_lines')->where('id', $match['id'])->value('payload'), true);
                    if ($code !== null && ($line['sku'] ?? null) !== $code['sku']) {
                        continue;
                    }
                    $this->appendMatch([...$match, 'productId' => $target['id'], 'method' => $code !== null ? 'code' : $match['method'], 'reviewed' => false]);
                    $affected[] = $match['id'];
                }
                array_push($affected, $subject, $target['id']);
            } elseif ($input['kind'] === 'product_rule') {
                $existing = $this->latest('product_rule_revisions', 'id', $subject);
                if (($existing['seq'] ?? 0) !== $input['expectedSeq']) {
                    throw new AccountingError('stale_review_version');
                }
                $product = $this->product($payload['productId']);
                if ($product['redirectId'] !== null || trim($payload['match']) === '' || ! is_int($payload['position']) || $payload['position'] < 0) {
                    throw new AccountingError('invalid_review_payload');
                }
                $rule = ['id' => $subject, 'chain' => 'coto', 'match' => trim($payload['match']), 'productId' => $product['id'], 'position' => $payload['position'], 'enabled' => $payload['enabled']];
                $this->repository->insert('product_rule_revisions', ['id' => $subject, 'product_id' => $product['id'], 'payload' => LedgerRepository::json($rule)]);
                $affected[] = $subject;
            } elseif ($input['kind'] === 'product_rematch') {
                if (! hash_equals($this->fingerprint(), $payload['expectedFingerprint'])) {
                    throw new AccountingError('stale_review_version');
                }
                $facts = $this->repository->query('receipt_facts')->where('revision_id', $subject)->first();
                if ($facts === null || ! $this->repository->query('source_revisions')->where('id', $subject)->whereRaw("payload->>'admission'='accepted'")->exists()) {
                    throw new AccountingError('missing_review_subject');
                }
                $this->matchReceipt($subject, true);
                $affected = $this->repository->query('source_lines')->where('revision_id', $subject)->pluck('id')->all();
            } else {
                throw new AccountingError('invalid_review_kind');
            }
            $result = ['decisionId' => Str::uuid()->toString(), 'affectedIds' => array_values(array_unique($affected)), 'duplicate' => false];
            $this->repository->insert('review_decisions', ['id' => $result['decisionId'], 'key' => $key, 'digest' => $digest, 'subject_id' => $subject, 'kind' => $input['kind'], 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result, ...$audit]), 'recorded_at' => $input['recordedAt']]);

            return $result;
        });
    }
}
