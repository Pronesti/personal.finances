<?php

namespace App\Domain\Reviews;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use Illuminate\Support\Str;

class MerchantProposals
{
    public function __construct(private LedgerRepository $repository, private MerchantProposalProvider $provider) {}

    public static function wireName(string $name): ?string
    {
        $name = trim(preg_replace('/\s+/u', ' ', preg_replace('/\d{6,}/u', '', $name)));

        return $name === '' || mb_strlen($name) > 300 || preg_match('/\d[\d .]*[.,]\d{2}|\bTC\d|%/iu', $name) ? null : $name;
    }

    public function read(): array
    {
        return (new MerchantReviews($this->repository))->current('proposal_revisions');
    }

    private function saveCommand(string $key, string $digest, array $input, array $result): void
    {
        $this->repository->insert('review_decisions', ['id' => Str::uuid()->toString(), 'key' => $key, 'digest' => $digest, 'subject_id' => $input['id'] ?? 'batch', 'kind' => 'merchant_proposal', 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result]), 'recorded_at' => $input['recordedAt']]);
    }

    private function command(array $input, callable $work): array
    {
        return $this->repository->transaction(function () use ($input, $work) {
            $key = 'proposal:'.$input['key'];
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->payload, true)['result'], 'duplicate' => true];
            }
            $result = [...$work(), 'duplicate' => false];
            $this->saveCommand($key, $digest, $input, $result);

            return $result;
        });
    }

    public function generate(array $input): array
    {
        return $this->command($input, function () {
            $reviews = new MerchantReviews($this->repository);
            $rows = $reviews->read()['purchases'];
            $existing = $this->read();
            $suppressed = [];
            foreach ($existing as $proposal) {
                if (in_array($proposal['state'], ['pending', 'rejected'], true)) {
                    $suppressed[$proposal['wireName']] = true;
                }
            }
            foreach ((new SourceClassification($this->repository))->eligible() as $fact) {
                if ($fact['purposeId'] !== 'unallocated') {
                    continue;
                }
                $merchant = $reviews->retainIdentity($fact['merchant']);
                $rows[] = ['subjectKind' => 'source', 'sourceLineId' => $fact['sourceLineId'], 'merchantId' => $merchant['id'], 'merchant' => $fact['merchant'], 'purchase' => ['allocations' => [['purposeId' => 'unallocated']]]];
            }
            $names = [];
            foreach ($rows as $row) {
                if ($row['purchase']['allocations'] === [] || array_any($row['purchase']['allocations'], fn ($allocation) => $allocation['purposeId'] !== 'unallocated')) {
                    continue;
                }
                $name = self::wireName($row['merchant']);
                if ($name !== null && ! isset($suppressed[$name]) && ! isset($names[$name]) && count($names) < 200) {
                    $names[$name] = $row;
                }
            }
            if ($names === []) {
                return ['created' => []];
            }
            try {
                $suggestions = $this->provider->suggest(array_keys($names));
            } catch (AccountingError $e) {
                throw $e;
            } catch (\Throwable) {
                throw new AccountingError('proposal_service_failed');
            }
            if (! array_is_list($suggestions) || count($suggestions) > count($names)) {
                throw new AccountingError('invalid_proposal_response');
            }
            $seen = [];
            $validated = [];
            foreach ($suggestions as $suggestion) {
                if (! is_array($suggestion) || ! is_string($suggestion['name'] ?? null) || ! isset($names[$suggestion['name']]) || isset($seen[$suggestion['name']]) || ! is_string($suggestion['accountId'] ?? null) || ! is_string($suggestion['purposeId'] ?? null) || ! is_numeric($suggestion['confidence'] ?? null) || ! is_finite((float) $suggestion['confidence']) || $suggestion['confidence'] < 0 || $suggestion['confidence'] > 1) {
                    throw new AccountingError('invalid_proposal_response');
                }
                try {
                    $reviews->target($suggestion['accountId'], $suggestion['purposeId']);
                } catch (\Throwable) {
                    throw new AccountingError('invalid_proposal_response');
                }
                $seen[$suggestion['name']] = true;
                $validated[] = $suggestion;
            }
            $created = [];
            foreach ($validated as $suggestion) {
                $row = $names[$suggestion['name']];
                $id = Str::uuid()->toString();
                $payload = ['id' => $id, 'merchantId' => $row['merchantId'], 'subjectKind' => $row['subjectKind'] ?? 'purchase', 'sourceLineId' => $row['sourceLineId'] ?? null, 'wireName' => $suggestion['name'], 'suggestedAccountId' => $suggestion['accountId'], 'suggestedPurposeId' => $suggestion['purposeId'], 'confidence' => (float) $suggestion['confidence'], 'state' => 'pending'];
                $this->repository->insert('proposal_revisions', ['id' => $id, 'merchant_id' => $row['merchantId'], 'prior_row_id' => null, 'state' => 'pending', 'payload' => LedgerRepository::json($payload)]);
                $created[] = $id;
            }

            return ['created' => $created];
        });
    }

    public function decide(array $input): array
    {
        return $this->command($input, function () use ($input) {
            $row = $this->repository->query('proposal_revisions')->where('id', $input['id'])->orderByDesc('seq')->first();
            abort_if($row === null, 404);
            $proposal = json_decode($row->payload, true);
            if ((int) $row->seq !== $input['expectedSeq'] || $row->state !== 'pending') {
                throw new AccountingError('stale_review_version');
            }
            $result = ['id' => $proposal['id'], 'state' => $input['action'] === 'accept' ? 'accepted' : 'rejected'];
            if ($input['action'] === 'accept') {
                $reviews = new MerchantReviews($this->repository);
                $historical = ($proposal['subjectKind'] ?? 'purchase') === 'source';
                if ($historical) {
                    validator($input, ['sourceLineId' => ['required', 'string'], 'expectedPreviousDecisionId' => ['present', 'nullable', 'string']])->validate();
                    $purchase = array_values(array_filter((new SourceClassification($this->repository))->eligible(), fn ($row) => $row['sourceLineId'] === $input['sourceLineId']))[0] ?? null;
                    abort_if($purchase === null, 404);
                    $purchase['merchantId'] = $reviews->resolve($purchase['merchant'])['id'];
                } else {
                    validator($input, ['purchaseId' => ['required', 'string'], 'cardId' => ['required', 'string'], 'expectedVersion' => ['required', 'integer']])->validate();
                    $purchase = array_values(array_filter($reviews->read()['purchases'], fn ($p) => $p['id'] === $input['purchaseId']))[0] ?? null;
                    abort_if($purchase === null, 404);
                }
                if ($purchase['merchantId'] !== $proposal['merchantId']) {
                    throw new AccountingError('stale_review_version');
                }
                if ($input['scope'] !== 'selected') {
                    $match = mb_strtoupper(trim($input['match'] ?? ''));
                    if ($match === '' || ! str_contains(mb_strtoupper($purchase['merchant']), $match)) {
                        throw new AccountingError('invalid_rule_match');
                    }
                    foreach ($reviews->current('merchant_rule_revisions') as $rule) {
                        if ($rule['match'] === $match && ($rule['accountId'] !== $input['accountId'] || $rule['purposeId'] !== $input['purposeId'])) {
                            throw new AccountingError('proposal_owned_rule_conflict');
                        }
                    }
                }
                $result['classification'] = $historical ? (new SourceClassification($this->repository))->decide($input) : $reviews->decide([...$input, 'kind' => 'purchase_classification']);
            }
            $this->repository->insert('proposal_revisions', ['id' => $proposal['id'], 'merchant_id' => $proposal['merchantId'], 'prior_row_id' => $row->row_id, 'state' => $result['state'], 'payload' => LedgerRepository::json([...$proposal, 'state' => $result['state']])]);

            return $result;
        });
    }
}
