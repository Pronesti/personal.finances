<?php

namespace App\Domain\Reports;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\Money;
use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\ProcessingBudget;

/** Read-only display analytics; no helper output can authorize ledger postings. */
class ReportCalculator
{
    public function calculate(array $input, ProcessingBudget $budget): array
    {
        $ids = [];
        foreach ($input['facts'] as $fact) {
            if (! is_string($fact['id']) || isset($ids[$fact['id']]) || ! is_int($fact['minor']) || abs($fact['minor']) > Money::MAX || ! in_array($fact['currency'], ['ARS', 'USD'], true)) {
                throw new AccountingError('invalid_report_identity');
            }
            $ids[$fact['id']] = true;
        }
        $scope = $input['scope'];
        foreach (['basis' => ['purchase', 'billed'], 'value' => ['nominal', 'real', 'usd'], 'tax' => ['incl', 'excl'], 'granularity' => ['month', 'quarter', 'year', 'all']] as $name => $values) {
            if (! in_array($scope[$name] ?? null, $values, true)) {
                throw new AccountingError('invalid_report_scope');
            }
        }
        foreach (['cpi', 'mep'] as $name) {
            foreach ($input['rates'][$name] as $month => $value) {
                if (! is_numeric($value) || ! is_finite((float) $value) || $value <= 0) {
                    throw new AccountingError('invalid_report_rate');
                }
            }
        }
        $payload = LedgerRepository::json($input);
        if (strlen($payload) > 16777216) {
            throw new AccountingError('processing_output_limit');
        }

        return app(PrivateProcess::class)->json(['node', base_path('processing/dist/reports.cjs')], $payload, $budget);
    }
}
