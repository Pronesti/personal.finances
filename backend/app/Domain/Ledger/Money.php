<?php

namespace App\Domain\Ledger;

use Brick\Math\BigInteger;
use Brick\Math\RoundingMode;

class Money
{
    public const int MAX = 9007199254740991;

    public static function minor(mixed $amount): int
    {
        if (! is_int($amount) || $amount < 0 || $amount > self::MAX) {
            throw new AccountingError('invalid_minor_units');
        }

        return $amount;
    }

    public static function source(int|float|string $amount): int
    {
        $text = is_float($amount) ? json_encode($amount, JSON_THROW_ON_ERROR) : (string) $amount;
        if (! preg_match('/^(-?)(\d+)(?:\.(\d+))?$/D', $text, $matches)) {
            throw new AccountingError('invalid_source_amount');
        }
        $fraction = $matches[3] ?? '';
        if (trim(substr($fraction, 2), '0') !== '') {
            throw new AccountingError('invalid_source_amount');
        }
        $value = BigInteger::of($matches[2])->multipliedBy(100)->plus((int) str_pad(substr($fraction, 0, 2), 2, '0'));
        if ($value->isGreaterThan(self::MAX)) {
            throw new AccountingError('invalid_source_amount');
        }

        return ($matches[1] === '-' ? -1 : 1) * $value->toInt();
    }

    /** @param list<int> $weights @return list<int> */
    public static function split(int $amount, array $weights): array
    {
        self::minor($amount);
        $total = 0;
        foreach ($weights as $weight) {
            $total = self::minor($total + self::minor($weight));
        }
        if ($total === 0 || $amount > $total) {
            throw new AccountingError('invalid_allocation');
        }
        $shares = array_map(fn (int $weight) => BigInteger::of($amount)->multipliedBy($weight)->dividedBy($total, RoundingMode::Down)->toInt(), $weights);
        $left = $amount - array_sum($shares);
        for ($index = 0; $left > 0; $index = ($index + 1) % count($shares)) {
            if ($shares[$index] < $weights[$index]) {
                $shares[$index]++;
                $left--;
            }
        }

        return $shares;
    }
}
