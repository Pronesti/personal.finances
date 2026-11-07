<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\LedgerRepository;
use stdClass;

class SourceIdentity
{
    public static function canonical(mixed $value): string
    {
        $sort = function ($item) use (&$sort) {
            if (is_object($item)) {
                $values = get_object_vars($item);
                ksort($values, SORT_STRING);

                return (object) array_map($sort, $values);
            }
            if (is_array($item)) {
                if (! array_is_list($item)) {
                    ksort($item, SORT_STRING);
                }

                return array_map($sort, $item);
            }

            return $item;
        };

        return LedgerRepository::json($sort($value));
    }

    public static function payloadDigest(stdClass $payload): string
    {
        $normalized = clone $payload;
        $normalized->file = null;

        return hash('sha256', self::canonical($normalized));
    }

    public static function line(string $revision, int $occurrence): string
    {
        if ($occurrence < 1 || trim($revision) === '') {
            throw new AccountingError('invalid_source_occurrence');
        }

        return LedgerRepository::json([$revision, $occurrence]);
    }

    public static function fingerprint(string $brand, stdClass $line, int $ordinal): string
    {
        $parts = [$brand, $line->date ?? '', $line->description, $line->ars ?? '', $line->usd ?? '', $line->installment_number ?? '', $line->installment_count ?? ''];

        return sha1(implode('|', $parts).'#'.$ordinal);
    }

    private static function distinct(string $first, string $second): bool
    {
        $a = json_decode($first, true);
        $b = json_decode($second, true);

        return is_array($a) && is_array($b) && count($a) === 2 && count($b) === 2 && $a[0] === $b[0] && $a[1] !== $b[1];
    }

    public static function identify(array $input, array $candidates): array
    {
        $review = fn ($reason) => ['status' => 'review', 'purchaseId' => null, 'reason' => $reason];
        $matched = fn ($id) => ['status' => 'matched', 'purchaseId' => $id, 'reason' => 'same_voucher'];
        $number = $input['installment'];
        $count = $input['installmentCount'];
        if (($number === null) !== ($count === null) || ($number !== null && (! is_int($number) || ! is_int($count) || $number < 1 || $count < $number))) {
            throw new AccountingError('invalid_installment_identity');
        }
        $eligible = array_values(array_filter($candidates, fn ($row) => $row['cardId'] === $input['cardId'] && $row['currency'] === $input['currency']));
        $exact = array_values(array_filter($eligible, fn ($row) => $row['sourceLineId'] === $input['sourceLineId']));
        if ($exact !== []) {
            foreach ($exact as $row) {
                foreach (['purchaseDate', 'amountMinor', 'voucher', 'installment', 'installmentCount'] as $key) {
                    if ($row[$key] !== $input[$key]) {
                        return $review('source_line_conflict');
                    }
                }
            }

            return count(array_unique(array_column($exact, 'purchaseId'))) === 1 ? $matched($exact[0]['purchaseId']) : $review('multiple_purchase_candidates');
        }
        $vouchers = $input['voucher'] === null ? [] : array_values(array_filter($eligible, fn ($row) => $row['voucher'] === $input['voucher'] && $row['purchaseDate'] === $input['purchaseDate'] && ! self::distinct($input['sourceLineId'], $row['sourceLineId'])));
        if ($vouchers !== []) {
            foreach ($vouchers as $row) {
                if ($row['amountMinor'] !== $input['amountMinor'] || $row['installmentCount'] !== $count || ($row['installment'] !== $number && ($row['installment'] === null || $number === null || $row['installment'] >= $number))) {
                    return $review('voucher_facts_conflict');
                }
            }

            return count(array_unique(array_column($vouchers, 'purchaseId'))) === 1 ? $matched($vouchers[0]['purchaseId']) : $review('multiple_purchase_candidates');
        }
        if ($number !== null && $number > 1) {
            return $review('missing_installment_history');
        }
        foreach ($eligible as $row) {
            if ($row['purchaseDate'] === $input['purchaseDate'] && $row['amountMinor'] === $input['amountMinor'] && ($input['voucher'] === null || $row['voucher'] === null) && ! self::distinct($input['sourceLineId'], $row['sourceLineId'])) {
                return $review('insufficient_identity_evidence');
            }
        }

        return ['status' => 'new', 'purchaseId' => null, 'reason' => 'distinct_source_line'];
    }
}
