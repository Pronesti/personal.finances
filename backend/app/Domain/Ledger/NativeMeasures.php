<?php

namespace App\Domain\Ledger;

use Brick\Math\BigInteger;

class NativeMeasures
{
    private static function add(array &$row, string $field, int|string $amount): void
    {
        $row[$field] = (string) BigInteger::of($row[$field])->plus($amount);
    }

    private static function emptyRow(): array
    {
        return ['expenseMinor' => '0', 'debtMinor' => '0', 'repaymentMinor' => '0'];
    }

    public function groups(array $groups, array $accounts, array $journals, string $currency, string $from, string $to): array
    {
        $map = array_column($accounts, null, 'id');
        $result = [];
        foreach ($groups as $group) {
            $row = ['groupId' => $group['id'], 'additive' => $group['additive'], ...self::emptyRow()];
            foreach ($journals as $journal) {
                if ($journal['currency'] !== $currency || $journal['effectiveDate'] > $to) {
                    continue;
                }
                foreach ($journal['lines'] as $line) {
                    $id = $line['accountId'];
                    $seen = [];
                    $included = false;
                    while ($id !== null) {
                        if (isset($seen[$id])) {
                            throw new AccountingError('account_cycle');
                        }
                        $seen[$id] = true;
                        if (in_array($id, $group['accountIds'], true)) {
                            $included = true;
                            break;
                        }
                        $id = $map[$id]['parentId'] ?? null;
                    }
                    if (! $included) {
                        continue;
                    }
                    $type = $map[$line['accountId']]['type'] ?? null;
                    $net = $line['debitMinor'] - $line['creditMinor'];
                    if ($type === 'liability') {
                        self::add($row, 'debtMinor', -$net);
                        if ($journal['kind'] === 'repayment' && $journal['effectiveDate'] >= $from) {
                            self::add($row, 'repaymentMinor', $net);
                        }
                    }
                    if ($type === 'expense' && $journal['effectiveDate'] >= $from) {
                        self::add($row, 'expenseMinor', $net);
                    }
                }
            }
            $result[] = $row;
        }

        return $result;
    }

    public function purposes(array $accounts, array $journals, array $purchases, array $state, string $card, string $currency, string $from, string $to): array
    {
        $map = array_column($accounts, null, 'id');
        $supported = array_column(array_filter($purchases, fn ($row) => $row['cardId'] === $card && $row['currency'] === $currency), null, 'purchaseId');
        $rows = [];
        $balance = BigInteger::zero();
        $repayments = BigInteger::zero();
        $ensure = function (?string $purpose) use (&$rows): string {
            $key = $purpose ?? '';
            $rows[$key] ??= ['purposeId' => $purpose, ...self::emptyRow()];

            return $key;
        };
        foreach ($journals as $journal) {
            if ($journal['cardId'] !== $card || $journal['currency'] !== $currency || $journal['effectiveDate'] > $to) {
                continue;
            }
            foreach ($journal['lines'] as $line) {
                $type = $map[$line['accountId']]['type'] ?? throw new AccountingError('report_account_missing');
                $net = $line['debitMinor'] - $line['creditMinor'];
                if ($type === 'expense' && $journal['effectiveDate'] >= $from) {
                    $key = $ensure($line['purposeId']);
                    self::add($rows[$key], 'expenseMinor', $net);
                }
                if ((isset($supported[$line['purchaseId'] ?? '']) || $journal['kind'] === 'cost') && in_array($type, ['expense', 'asset'], true)) {
                    $key = $ensure($line['purposeId']);
                    self::add($rows[$key], 'debtMinor', $net);
                }
                if ($type === 'liability') {
                    $balance = $balance->minus($net);
                    if ($journal['kind'] === 'repayment' && $journal['effectiveDate'] >= $from) {
                        $repayments = $repayments->plus($net);
                    }
                }
            }
        }
        $current = [];
        foreach ([...$state['attributionRevisions'], ...$state['attributions']] as $row) {
            $current[$row['paymentId']] = max($current[$row['paymentId']] ?? 0, $row['revision']);
        }
        $payments = array_column($state['payments'], null, 'id');
        $assigned = BigInteger::zero();
        foreach ($state['attributions'] as $row) {
            $payment = $payments[$row['paymentId']] ?? null;
            if ($row['revision'] !== $current[$row['paymentId']] || $payment === null || $payment['cardId'] !== $card || $payment['currency'] !== $currency || $payment['effectiveDate'] > $to) {
                continue;
            }
            $key = $ensure($row['purposeId']);
            self::add($rows[$key], 'debtMinor', -$row['minor']);
            if ($payment['effectiveDate'] >= $from) {
                self::add($rows[$key], 'repaymentMinor', $row['minor']);
                $assigned = $assigned->plus($row['minor']);
            }
        }
        $attributed = BigInteger::zero();
        foreach ($rows as $row) {
            $attributed = $attributed->plus($row['debtMinor']);
        }
        $residual = $balance->minus($attributed);
        $flow = $repayments->minus($assigned);
        if (! $residual->isZero() || ! $flow->isZero()) {
            $key = $ensure(null);
            self::add($rows[$key], 'debtMinor', (string) $residual);
            self::add($rows[$key], 'repaymentMinor', (string) $flow);
        }
        ksort($rows, SORT_STRING);

        return array_values($rows);
    }
}
