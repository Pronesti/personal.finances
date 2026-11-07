<?php

namespace App\Domain\Reviews;

use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\FinancialFacts;
use App\Domain\Reports\ReportSnapshot;
use Illuminate\Support\Str;

class MerchantReviews
{
    private ?array $merchantCache = null;

    public function __construct(private LedgerRepository $repository) {}

    public function current(string $table): array
    {
        if ($table === 'merchant_revisions') {
            return $this->merchantCache ??= (new ReceiptProducts($this->repository))->current($table);
        }

        return (new ReceiptProducts($this->repository))->current($table);
    }

    private function append(string $table, array $value, array $columns = []): void
    {
        if ($table === 'merchant_revisions') {
            $this->merchantCache = null;
        }
        unset($value['seq']);
        $this->repository->insert($table, ['id' => $value['id'], ...$columns, 'payload' => LedgerRepository::json($value)]);
    }

    public function resolve(string $name): array
    {
        $normalized = mb_strtoupper(trim(FinancialFacts::merchant($name)));
        $merchants = $this->current('merchant_revisions');
        $aliases = array_values(array_filter($merchants, fn ($row) => $row['redirectId'] !== null && str_starts_with($normalized, $row['normalizedName'])));
        usort($aliases, fn ($a, $b) => mb_strlen($b['normalizedName']) <=> mb_strlen($a['normalizedName']));
        $id = hash('sha256', $normalized);
        $merchant = $aliases[0] ?? array_values(array_filter($merchants, fn ($row) => $row['id'] === $id))[0] ?? ['id' => $id, 'normalizedName' => $normalized, 'displayName' => null, 'redirectId' => null];
        $map = array_column($merchants, null, 'id');
        $seen = [];
        while ($merchant['redirectId'] !== null) {
            if (isset($seen[$merchant['id']])) {
                throw new AccountingError('merchant_alias_cycle');
            } $seen[$merchant['id']] = true;
            $merchant = $map[$merchant['redirectId']] ?? throw new AccountingError('missing_review_subject');
        }

        return $merchant;
    }

    public function retainIdentity(string $name): array
    {
        $normalized = mb_strtoupper(trim(FinancialFacts::merchant($name)));
        $id = hash('sha256', $normalized);
        $resolved = $this->resolve($name);
        if (! $this->repository->query('merchant_entities')->where('id', $id)->exists()) {
            $this->repository->insert('merchant_entities', ['id' => $id]);
            $merchant = ['id' => $id, 'normalizedName' => $normalized, 'displayName' => null, 'redirectId' => $resolved['id'] === $id ? null : $resolved['id']];
            $this->append('merchant_revisions', $merchant, ['redirect_id' => $merchant['redirectId']]);
        }

        return $this->resolve($name);
    }

    public function register(string $purchase, string $card, string $name, string $line): void
    {
        $normalized = mb_strtoupper(trim(FinancialFacts::merchant($name)));
        $id = hash('sha256', $normalized);
        $this->retainIdentity($name);
        $existing = array_values(array_filter($this->current('merchant_purchase_revisions'), fn ($row) => $row['id'] === $purchase))[0] ?? null;
        if ($existing !== null) {
            return;
        }
        $this->append('merchant_purchase_revisions', ['id' => $purchase, 'purchaseId' => $purchase, 'cardId' => $card, 'merchantId' => $id, 'sourceLineId' => $line], ['merchant_id' => $id, 'source_line_id' => $line, 'card_id' => $card]);
    }

    public function classification(string $name): ?array
    {
        $merchant = $this->resolve($name);
        $rules = array_values(array_filter($this->current('merchant_rule_revisions'), fn ($row) => $row['enabled']));
        usort($rules, fn ($a, $b) => ($a['position'] <=> $b['position']) ?: strcmp($a['id'], $b['id']));
        foreach ($rules as $rule) {
            if (str_contains($merchant['normalizedName'], $rule['match'])) {
                return $rule;
            }
        }

        return null;
    }

    public function read(): array
    {
        return $this->repository->readSnapshot(function () {
            $merchants = $this->current('merchant_revisions');
            $map = array_column($merchants, null, 'id');
            $purchases = [];
            foreach ($this->current('merchant_purchase_revisions') as $row) {
                $purchase = $this->repository->purchase($row['id']);
                if ($purchase === null) {
                    continue;
                } $merchant = $map[$row['merchantId']] ?? null;
                if ($merchant === null) {
                    continue;
                }$resolved = $this->resolve($merchant['normalizedName']);
                $purchases[] = [...$row, 'merchantId' => $resolved['id'], 'merchant' => $resolved['displayName'] ?? $resolved['normalizedName'], 'purchase' => $purchase];
            }
            usort($purchases, fn ($a, $b) => strcmp($a['id'], $b['id']));

            return ['merchants' => $merchants, 'purchases' => $purchases, 'rules' => $this->current('merchant_rule_revisions'), 'history' => $this->repository->query('review_decisions')->whereIn('kind', ['purchase_classification', 'merchant_merge', 'merchant_rule'])->orderByDesc('seq')->limit(100)->get()->map(fn ($row) => ['id' => $row->id, 'kind' => $row->kind, 'subjectId' => $row->subject_id, 'recordedAt' => $row->recorded_at])->all()];
        });
    }

    public function preview(string $card, string $match): array
    {
        $match = mb_strtoupper(trim($match));
        if (mb_strlen($match) < 3) {
            throw new AccountingError('invalid_rule_match');
        }
        $rows = array_values(array_filter($this->read()['purchases'], fn ($row) => $row['cardId'] === $card && str_contains(mb_strtoupper($row['merchant']), $match)));
        $versions = array_map(fn ($row) => ['purchaseId' => $row['id'], 'version' => $row['purchase']['version'], 'principalMinor' => $row['purchase']['principalMinor']], $rows);

        return ['purchases' => $rows, 'versions' => $versions, 'fingerprint' => FinancialCommands::digest(['cardId' => $card, 'match' => $match, 'versions' => $versions])];
    }

    public function target(string $id, string $purpose, ?string $currency = null): void
    {
        $account = $this->repository->query('accounts')->where('id', $id)->first();
        abort_if($account === null, 404);
        if (! $account->enabled || ! $account->posting || ! in_array($account->type, ['expense', 'asset'], true) || $this->repository->query('accounts')->where('parent_id', $id)->exists()) {
            throw new AccountingError('invalid_posting_account');
        }
        if ($currency !== null && $account->currency !== null && $account->currency !== $currency) {
            throw new AccountingError('account_currency_mismatch');
        }
        $purposes = array_column(json_decode(file_get_contents(resource_path('catalog.json')), true)['groups'], 'id');
        if (! in_array($purpose, ['unallocated', ...$purposes], true) || ($account->primary_purpose_id !== null && $account->primary_purpose_id !== $purpose)) {
            throw new AccountingError('invalid_primary_purpose');
        }
    }

    public function futureRule(string $match, string $account, string $purpose): string
    {
        $rules = $this->current('merchant_rule_revisions');
        $owned = array_values(array_filter($rules, fn ($row) => $row['match'] === $match))[0] ?? null;
        $ruleId = $owned['id'] ?? Str::uuid()->toString();
        $position = 1;
        usort($rules, fn ($a, $b) => ($a['position'] <=> $b['position']) ?: strcmp($a['id'], $b['id']));
        foreach ($rules as $rule) {
            if ($rule['id'] !== $ruleId) {
                $this->append('merchant_rule_revisions', [...$rule, 'position' => $position++], ['account_id' => $rule['accountId']]);
            }
        }
        $this->append('merchant_rule_revisions', ['id' => $ruleId, 'match' => $match, 'accountId' => $account, 'purposeId' => $purpose, 'position' => 0, 'enabled' => true], ['account_id' => $account]);

        return $ruleId;
    }

    public function mergePreview(string $sourceId, string $targetId): array
    {
        return $this->repository->readSnapshot(function () use ($sourceId, $targetId) {
            $merchants = array_column($this->current('merchant_revisions'), null, 'id');
            $source = $merchants[$sourceId] ?? null;
            $target = $merchants[$targetId] ?? null;
            abort_if($source === null || $target === null, 404);
            if ($sourceId === $targetId || $source['redirectId'] !== null || $target['redirectId'] !== null || str_starts_with($target['normalizedName'], $source['normalizedName'])) {
                throw new AccountingError('merchant_alias_cycle');
            }
            $family = array_values(array_filter($merchants, fn ($row) => $row['redirectId'] === null && str_starts_with($row['normalizedName'], $source['normalizedName'])));
            usort($family, fn ($a, $b) => strcmp($a['id'], $b['id']));
            $facts = array_values(array_filter((new ReportSnapshot($this->repository))->read()['facts'], fn ($fact) => is_string($fact['merchant']) && str_starts_with(mb_strtoupper($fact['merchant']), $source['normalizedName'])));
            $purchaseIds = array_values(array_unique(array_filter(array_column($facts, 'purchaseId'))));
            sort($purchaseIds, SORT_STRING);

            return ['merchants' => $family, 'target' => $target, 'affectedPurchaseIds' => $purchaseIds, 'affectedFactIds' => array_column($facts, 'id'), 'fingerprint' => FinancialCommands::digest(['family' => $family, 'target' => $target, 'facts' => $facts])];
        });
    }

    public function decide(array $input): array
    {
        return $this->repository->transaction(function () use ($input) {
            $key = 'merchant:'.rawurlencode($input['key']);
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->payload, true)['result'], 'duplicate' => true];
            }
            $affected = [];
            $ruleId = null;
            if ($input['kind'] === 'purchase_classification') {
                $purchase = $this->repository->purchase($input['purchaseId']);
                abort_if($purchase === null || $purchase['cardId'] !== $input['cardId'], 404);
                $this->target($input['accountId'], $input['purposeId']);
                if ($purchase['version'] !== $input['expectedVersion']) {
                    throw new AccountingError('stale_purchase_version');
                }
                $ids = $input['scope'] === 'future_rule' ? [] : [$input['purchaseId']];
                $match = mb_strtoupper(trim($input['match'] ?? ''));
                if ($input['scope'] !== 'selected' && mb_strlen($match) < 3) {
                    throw new AccountingError('invalid_rule_match');
                }
                if ($input['scope'] === 'matching_history') {
                    $preview = $this->preview($input['cardId'], $match);
                    $confirmed = $input['confirmedPurchaseIds'];
                    sort($confirmed, SORT_STRING);
                    $ids = array_column($preview['versions'], 'purchaseId');
                    if (! $input['confirmHistory'] || $ids === [] || $ids !== $confirmed || ! hash_equals($preview['fingerprint'], $input['expectedFingerprint'])) {
                        throw new AccountingError('history_confirmation_required');
                    }
                }
                if ($input['scope'] !== 'selected') {
                    $ruleId = $this->futureRule($match, $input['accountId'], $input['purposeId']);
                }
                foreach ($ids as $id) {
                    $current = $this->repository->purchase($id);
                    $result = (new FinancialCommands($this->repository))->correct(['key' => $key.':'.$id, 'cardId' => $input['cardId'], 'purchaseId' => $id, 'expectedVersion' => $current['version'], 'replacement' => [...$current, 'allocations' => [['accountId' => $input['accountId'], 'purposeId' => $input['purposeId'], 'minor' => $current['principalMinor']]]], 'reason' => 'Explicit classification correction', 'recordedAt' => $input['recordedAt']]);
                    if ($result['status'] === 'review') {
                        throw new AccountingError($result['reviewCode'] ?? 'classification_review_required');
                    }
                }$affected = $ids;
            } elseif ($input['kind'] === 'merchant_merge') {
                $merchants = array_column($this->current('merchant_revisions'), null, 'id');
                $source = $merchants[$input['sourceId']] ?? null;
                $target = $merchants[$input['targetId']] ?? null;
                abort_if($source === null || $target === null, 404);
                if ($source['seq'] !== $input['expectedSeq']) {
                    throw new AccountingError('stale_review_version');
                }if ($source['id'] === $target['id'] || str_starts_with($target['normalizedName'], $source['normalizedName']) || $source['redirectId'] !== null || $target['redirectId'] !== null) {
                    throw new AccountingError('merchant_alias_cycle');
                }
                $preview = $this->mergePreview($input['sourceId'], $input['targetId']);
                $confirmed = $input['confirmedMerchantIds'] ?? [];
                sort($confirmed, SORT_STRING);
                if (! ($input['confirmMerge'] ?? false) || array_column($preview['merchants'], 'id') !== $confirmed || ! hash_equals($preview['fingerprint'], $input['expectedMergeFingerprint'] ?? '')) {
                    throw new AccountingError('merge_confirmation_required');
                }
                foreach ($merchants as $merchant) {
                    if ($merchant['redirectId'] === null && str_starts_with($merchant['normalizedName'], $source['normalizedName'])) {
                        $this->append('merchant_revisions', [...$merchant, 'redirectId' => $target['id']], ['redirect_id' => $target['id']]);
                        $affected[] = $merchant['id'];
                    }
                }
            } else {
                throw new AccountingError('invalid_review_kind');
            }
            $result = ['decisionId' => Str::uuid()->toString(), 'affectedPurchaseIds' => $affected, 'ruleId' => $ruleId, 'duplicate' => false];
            $subject = $input['purchaseId'] ?? $input['sourceId'];
            $this->repository->insert('review_decisions', ['id' => $result['decisionId'], 'key' => $key, 'digest' => $digest, 'subject_id' => $subject, 'kind' => $input['kind'], 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result]), 'recorded_at' => $input['recordedAt']]);

            return $result;
        });
    }
}
