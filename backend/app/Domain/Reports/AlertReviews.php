<?php

namespace App\Domain\Reports;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use Illuminate\Support\Str;

class AlertReviews
{
    public function __construct(private LedgerRepository $repository) {}

    public function decide(array $input, ReferenceTables $references, ReportCalculator $calculator, ProcessingBudget $budget): array
    {
        return $this->repository->transaction(function () use ($input, $references, $calculator, $budget) {
            $key = 'alert-review:'.rawurlencode($input['key']);
            $digest = FinancialCommands::digest([...$input, 'locale' => null]);
            $saved = $this->repository->query('review_decisions')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

return [...json_decode($saved->payload, true)['result'], 'duplicate' => true];
            }
            $previous = $this->repository->query('review_decisions')->where('kind', 'alert_state')->where('subject_id', $input['alertId'])->orderByDesc('seq')->first();
            if ($input['expectedPreviousDecisionId'] !== ($previous?->id)) {
                throw new AccountingError('stale_review_version');
            }
            $snapshot = (new ReportSnapshot($this->repository))->read();
            $models = $calculator->calculate([...$snapshot, 'rates' => $references->read(), 'scope' => ['basis' => 'purchase', 'value' => 'nominal', 'tax' => 'excl', 'granularity' => 'month', 'period' => null], 'locale' => $input['locale']], $budget);
            $alert = array_values(array_filter($models['commitments']['alerts'], fn ($row) => $row['key'] === $input['alertId']))[0] ?? null;
            abort_if($alert === null, 404);
            $result = ['decisionId' => Str::uuid()->toString(), 'alertId' => $input['alertId'], 'state' => $input['state'], 'duplicate' => false];
            $this->repository->insert('review_decisions', ['id' => $result['decisionId'], 'key' => $key, 'digest' => $digest, 'subject_id' => $input['alertId'], 'kind' => 'alert_state', 'recorded_at' => $input['recordedAt'], 'payload' => LedgerRepository::json(['input' => $input, 'result' => $result, 'previousDecisionId' => $previous?->id, 'source' => $alert['source'] === 'integrity' ? ['kind' => $alert['kind'], 'message' => $alert['message']] : null])]);
            $budget->assertNonOcr();

            return $result;
        });
    }
}
