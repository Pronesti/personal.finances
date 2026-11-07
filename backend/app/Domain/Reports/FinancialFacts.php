<?php

namespace App\Domain\Reports;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\Money;

/** Pure native-cent projection over an already owner-qualified repeatable-read snapshot. */
class FinancialFacts
{
    public static function validDate(mixed $date): bool
    {
        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) && checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4));
    }

    public static function minor(mixed $value): int
    {
        if (is_string($value) && preg_match('/^-?\d+$/D', $value)) {
            $value = (int) $value;
        }
        if (! is_int($value) || $value < -Money::MAX || $value > Money::MAX) {
            throw new AccountingError('invalid_minor_units');
        }

        return $value;
    }

    public static function cycle(string $closing, ?string $previous): string
    {
        if (! self::validDate($closing) || ($previous !== null && ! self::validDate($previous))) {
            throw new AccountingError('invalid_report_date');
        }
        $end = new \DateTimeImmutable($closing.'T00:00:00Z');
        $start = $previous === null ? $end->modify('-30 days') : new \DateTimeImmutable($previous.'T00:00:00Z');

        return gmdate('Y-m', (int) floor(($start->getTimestamp() + $end->getTimestamp()) / 2));
    }

    public static function merchant(string $description): string
    {
        $value = preg_replace('/^(MERPAGO|MERCADOPAGO|DLOCAL|DLO|PAYU|EBANX|\d+)\*/iu', '', trim($description));
        $value = preg_replace('/[._*]+/u', ' ', $value);
        $value = preg_replace('/\s*\S*(USD|CLP|EUR|BRL|UYU)\s*[\d.,\s]+$/iu', '', $value);
        $value = preg_replace('/\s+(ID:)?\d{6,}(-\d+)*$/iu', '', $value);

        return mb_strtoupper(trim(preg_replace('/\s+/u', ' ', $value)));
    }

    public function project(array $snapshot): array
    {
        $journals = array_column($snapshot['journals'], null, 'id');
        $accounts = array_column($snapshot['accounts'], null, 'id');
        $sources = $snapshot['journalSources'];
        $purchases = array_column($snapshot['purchases'], null, 'purchaseId');
        $facts = [];
        $base = function (array $journal, ?string $purchase) use ($sources, $purchases): array {
            $source = $sources[$journal['id']] ?? null;
            $original = $sources[$purchases[$purchase]['journalId'] ?? ''] ?? null;
            $description = $source['payload']['description'] ?? $original['payload']['description'] ?? null;

            return ['origin' => 'ledger', 'journalId' => $journal['id'], 'description' => $description, 'installmentNumber' => $source['payload']['installment_number'] ?? null, 'installmentCount' => $source['payload']['installment_count'] ?? null, 'purchaseId' => $purchase, 'cardId' => $journal['cardId'], 'currency' => $journal['currency'], 'effectiveDate' => $journal['effectiveDate'], 'merchant' => $description === null ? null : self::merchant($description), 'sourceLineId' => $source['lineId'] ?? null, 'statementId' => $source['revisionId'] ?? null, 'cycleMonth' => isset($source['closingDate']) ? self::cycle($source['closingDate'], $source['previousClosingDate'] ?? null) : null, 'coverage' => $journal['kind'] === 'opening' ? 'opening' : ($source === null ? 'uncertain' : 'complete')];
        };
        $expense = function (string $id, string $kind, ?string $purchase) use (&$facts, $journals, $accounts, $base): void {
            $journal = $journals[$id] ?? null;
            if ($journal === null) {
                throw new AccountingError('report_journal_missing');
            }
            foreach ($journal['lines'] as $ordinal => $line) {
                if (($accounts[$line['accountId']]['type'] ?? null) === 'expense') {
                    $facts[] = [...$base($journal, $purchase ?? $line['purchaseId']), 'id' => $id.':'.$ordinal, 'kind' => $kind, 'accountId' => $line['accountId'], 'purposeId' => $line['purposeId'], 'minor' => self::minor($line['debitMinor'] - $line['creditMinor'])];
                }
            }
        };
        foreach ($purchases as $purchase) {
            $expense($purchase['journalId'], 'purchase', $purchase['purchaseId']);
        }
        foreach ($snapshot['creditJournalIds'] as $id) {
            $purchase = null;
            foreach ($journals[$id]['lines'] as $line) {
                if ($line['purchaseId'] !== null) {
                    $purchase = $line['purchaseId'];
                    break;
                }
            }$expense($id, 'credit', $purchase);
        }
        foreach ($snapshot['billings'] as $billing) {
            $journal = $journals[$billing['journalId']] ?? null;
            if ($journal === null) {
                throw new AccountingError('report_journal_missing');
            }
            if (($billing['origin'] ?? null) === 'opening_balance') {
                continue;
            }
            $obligation = isset($billing['openingObligationId']) ? ($snapshot['openingObligations'][$billing['openingObligationId']] ?? null) : null;
            if (isset($billing['openingObligationId']) && $obligation === null) {
                throw new AccountingError('report_opening_obligation_missing');
            }
            $purchase = $obligation ?? ($purchases[$billing['purchaseId']] ?? null);
            if ($purchase === null) {
                continue;
            }
            $shares = Money::split($billing['amountMinor'], array_column($purchase['allocations'], 'minor'));
            foreach ($purchase['allocations'] as $index => $allocation) {
                if ($shares[$index] === 0) {
                    continue;
                }
                if ($obligation === null && ($accounts[$allocation['accountId']]['type'] ?? null) !== 'expense') {
                    continue;
                }
                $row = $base($journal, $obligation === null ? $purchase['purchaseId'] : null);
                $facts[] = [...$row, 'id' => $journal['id'].($obligation === null ? ':billing:' : ':opening-billing:').$index, 'kind' => 'billing', 'accountId' => $obligation === null ? $allocation['accountId'] : 'expense:unallocated', 'purposeId' => $allocation['purposeId'], 'minor' => $shares[$index], 'purchaseDate' => $obligation === null ? $purchase['effectiveDate'] : $obligation['purchaseDate'], 'installmentNumber' => $billing['installment'], 'installmentCount' => $obligation['installmentCount'] ?? $row['installmentCount'], 'financed' => $obligation !== null || $purchase['principalMinor'] > $billing['amountMinor'] || $billing['installment'] > 1 || ($row['installmentCount'] ?? 0) > 1, 'cycleMonth' => $row['cycleMonth'] ?? substr($journal['effectiveDate'], 0, 7)];
            }
        }
        foreach ($journals as $journal) {
            if ($journal['kind'] === 'cost') {
                $expense($journal['id'], 'cost', null);
            }
            if (in_array($journal['kind'], ['repayment', 'opening'], true)) {
                $minor = 0;
                foreach ($journal['lines'] as $line) {
                    if (($accounts[$line['accountId']]['type'] ?? null) === 'liability') {
                        $minor = self::minor($minor + $line['creditMinor'] - $line['debitMinor']);
                    }
                }
                $facts[] = [...$base($journal, null), 'id' => $journal['id'].':'.$journal['kind'], 'kind' => $journal['kind'] === 'repayment' ? 'payment' : 'opening', 'accountId' => null, 'purposeId' => null, 'minor' => $journal['kind'] === 'repayment' ? -$minor : $minor];
            }
        }

        return $facts;
    }
}
