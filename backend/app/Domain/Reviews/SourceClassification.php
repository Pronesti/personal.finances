<?php

namespace App\Domain\Reviews;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReportSnapshot;
use Illuminate\Support\Str;

class SourceClassification
{
    public function __construct(private LedgerRepository $repository) {}

    public function eligible(): array
    {
        $snapshot = (new ReportSnapshot($this->repository))->read();
        $rows = [];
        foreach ($snapshot['facts'] as $fact) {
            if ($fact['origin'] !== 'historical_acquisition') {
                continue;
            }$previous = $this->repository->query('review_events')->where('subject_id', $fact['sourceLineId'])->where('code', 'historical_source_classification')->orderByDesc('ordinal')->value('id');
            $rows[] = [...$fact, 'previousDecisionId' => $previous];
        }
        usort($rows, fn ($a, $b) => strcmp($a['sourceLineId'], $b['sourceLineId']));

        return $rows;
    }

    public function preview(string $source, string $match): array
    {
        $all = $this->eligible();
        $subject = array_values(array_filter($all, fn ($row) => $row['sourceLineId'] === $source))[0] ?? null;
        abort_if($subject === null, 404);
        $match = mb_strtoupper(trim($match));
        if (mb_strlen($match) < 3) {
            throw new AccountingError('invalid_rule_match');
        }
        $rows = array_values(array_filter($all, fn ($row) => $row['cardId'] === $subject['cardId'] && str_contains(mb_strtoupper($row['merchant']), $match)));

        return ['rows' => $rows, 'fingerprint' => FinancialCommands::digest(['sourceLineId' => $source, 'match' => $match, 'rows' => $rows])];
    }

    public function decide(array $input): array
    {
        if (! in_array($input['scope'], ['selected', 'future_rule', 'matching_history'], true)) {
            throw new AccountingError('invalid_classification_scope');
        }

        return $this->repository->transaction(function () use ($input) {
            $key = 'source-classification:'.rawurlencode($input['key']);
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->payload, true)['result'], 'duplicate' => true];
            }
            $subject = array_values(array_filter($this->eligible(), fn ($row) => $row['sourceLineId'] === $input['sourceLineId']))[0] ?? null;
            abort_if($subject === null, 404);
            $merchant = new MerchantReviews($this->repository);
            $merchant->target($input['accountId'], $input['purposeId'], $subject['currency']);
            if ($subject['previousDecisionId'] !== $input['expectedPreviousDecisionId']) {
                throw new AccountingError('stale_review_version');
            }
            $rows = $input['scope'] === 'future_rule' ? [] : [$subject];
            $match = mb_strtoupper(trim($input['match'] ?? ''));
            if ($input['scope'] !== 'selected' && mb_strlen($match) < 3) {
                throw new AccountingError('invalid_rule_match');
            }
            if ($input['scope'] === 'matching_history') {
                $preview = $this->preview($input['sourceLineId'], $match);
                $rows = $preview['rows'];
                $confirmed = $input['confirmedSourceLineIds'];
                sort($confirmed, SORT_STRING);
                if (! $input['confirmHistory'] || $rows === [] || array_column($rows, 'sourceLineId') !== $confirmed || ! hash_equals($preview['fingerprint'], $input['expectedFingerprint'])) {
                    throw new AccountingError('history_confirmation_required');
                }
            }
            $ruleId = $input['scope'] === 'selected' ? null : $merchant->futureRule($match, $input['accountId'], $input['purposeId']);
            foreach ($rows as $row) {
                $merchant->target($input['accountId'], $input['purposeId'], $row['currency']);
                $this->repository->insert('review_events', ['id' => Str::uuid()->toString(), 'subject_id' => $row['sourceLineId'], 'prior_decision_id' => $row['previousDecisionId'], 'code' => 'historical_source_classification', 'params' => LedgerRepository::json(['accountId' => $input['accountId'], 'purposeId' => $input['purposeId'], 'scope' => $input['scope'], 'match' => $match]), 'source_line_ids' => LedgerRepository::json([$row['sourceLineId']]), 'state' => 'reviewed', 'recorded_at' => $input['recordedAt']]);
            }
            $result = ['decisionId' => Str::uuid()->toString(), 'affectedSourceLineIds' => array_column($rows, 'sourceLineId'), 'ruleId' => $ruleId, 'duplicate' => false];
            $this->repository->insert('review_decisions', ['id' => $result['decisionId'], 'key' => $key, 'digest' => $digest, 'subject_id' => $input['sourceLineId'], 'kind' => 'source_classification', 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result]), 'recorded_at' => $input['recordedAt']]);

            return $result;
        });
    }
}
