<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\Money;
use Brick\Math\BigInteger;
use Brick\Math\RoundingMode;

/** Independent PHP admission gate; extraction helpers cannot authorize postings. */
class ReceiptVerification
{
    private static function signed(mixed $value): int
    {
        if (! is_int($value) || $value < -Money::MAX || $value > Money::MAX) {
            throw new AccountingError('invalid_source_amount');
        }

        return $value;
    }

    public static function verify(array $parsed): array
    {
        $errors = [];
        $warnings = array_values(array_filter($parsed['notes'], fn ($note) => ! str_contains($note, 'has no line total')));
        $date = $parsed['header']['date'];
        if (! is_string($date) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) || ! checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4))) {
            $errors[] = 'date not read from the header';
        }
        if (! $parsed['header']['fiscalNumber']) {
            $errors[] = 'ticket number (NRO.T.) not read from the header';
        }
        if ($parsed['items'] === []) {
            $errors[] = 'no items read';
        }
        $subtotal = 0;
        $discounts = 0;
        $positions = [];
        foreach ($parsed['items'] as $item) {
            if (! is_int($item['position']) || isset($positions[$item['position']]) || Money::minor($item['qtyMilli']) === 0 || ! in_array($item['unit'], ['un', 'kg'], true)) {
                throw new AccountingError('invalid_receipt_item');
            }
            $positions[$item['position']] = true;
            if ($item['lineTotalCents'] === null) {
                $errors[] = 'item '.$item['position'].' has no line total';
            } else {
                $subtotal = Money::minor($subtotal + Money::minor($item['lineTotalCents']));
            }
            $itemDiscounts = 0;
            foreach ($item['discounts'] as $discount) {
                if (self::signed($discount['amountCents']) >= 0 || ! in_array($discount['tag'], ['A', 'M'], true)) {
                    throw new AccountingError('invalid_receipt_discount');
                }
                $discounts = self::signed($discounts + $discount['amountCents']);
                $itemDiscounts = self::signed($itemDiscounts + $discount['amountCents']);
            }
            if ($item['lineTotalCents'] !== null && self::signed($item['lineTotalCents'] + $itemDiscounts) < 0) {
                $errors[] = 'item '.$item['position'].' has a negative net amount';
            }
        }
        $total = self::signed($subtotal + $discounts);
        $checks = [];
        foreach (['subtotal' => $subtotal, 'discounts' => $discounts, 'total' => $total] as $name => $computed) {
            $printed = $parsed['footer'][$name.'Cents'];
            if ($printed !== null) {
                self::signed($printed);
            } else {
                $errors[] = 'printed '.$name.' not read';
            }
            $checks[] = ['name' => $name, 'computed' => $computed, 'printed' => $printed, 'ok' => $printed !== null && $printed === $computed];
        }
        if ($parsed['footer']['savingsCents'] !== null && $parsed['footer']['savingsCents'] !== -$discounts) {
            $warnings[] = 'printed savings differ from item discounts';
        }

        $byLabel = [];
        foreach ($parsed['items'] as $item) {
            if (($item['unitPriceCents'] ?? null) !== null && $item['lineTotalCents'] !== null) {
                $expected = BigInteger::of($item['qtyMilli'])->multipliedBy(Money::minor($item['unitPriceCents']))->dividedBy(1000, RoundingMode::HalfUp);
                if ($expected->minus($item['lineTotalCents'])->abs()->isGreaterThan(1)) {
                    $warnings[] = 'item '.$item['position'].': printed unit price differs from line total';
                }
            }
            foreach ($item['discounts'] as $discount) {
                $key = mb_strtoupper(trim(preg_replace('/\s+/u', ' ', $discount['label'] ?? '')));
                $byLabel[$key] = ($byLabel[$key] ?? 0) + $discount['amountCents'];
            }
        }
        $offers = [];
        foreach ($parsed['footer']['offers'] ?? [] as $offer) {
            $key = mb_strtoupper(trim(preg_replace('/\s+/u', ' ', $offer['label'])));
            $computed = $byLabel[$key] ?? null;
            $printed = $offer['amountCents'];
            if ($printed !== null) {
                self::signed($printed);
            }
            $ok = $computed !== null && $printed !== null && $computed === -$printed;
            $offers[] = ['label' => $offer['label'], 'printed' => $printed, 'computed' => $computed, 'ok' => $ok];
            if (! $ok) {
                $warnings[] = 'offer '.$offer['label'].': printed amount differs from item discounts';
            }
        }

        return ['ok' => $errors === [] && count(array_filter($checks, fn ($check) => ! $check['ok'])) === 0, 'checks' => $checks, 'offers' => $offers, 'warnings' => $warnings, 'errors' => $errors];
    }
}
