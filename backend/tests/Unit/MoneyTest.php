<?php

namespace Tests\Unit;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\Money;
use PHPUnit\Framework\TestCase;

class MoneyTest extends TestCase
{
    public function test_proportional_remainder_follows_fixture_order_without_float_products(): void
    {
        $fixture = json_decode(file_get_contents(dirname(__DIR__, 3).'/docs/rebuild/fixtures/outcomes.json'), true)['allocation'];
        $this->assertSame($fixture['shares'], Money::split($fixture['amount'], $fixture['weights']));
        $this->assertSame([4503599627370496, 4503599627370495], Money::split(Money::MAX, [4503599627370496, 4503599627370495]));
        $this->assertSame([1, 0, 1], Money::split(2, [1, 0, 2]));
    }

    public function test_source_money_preserves_cents_and_rejects_fractional_or_unsafe_values(): void
    {
        $this->assertSame(1234, Money::source('12.3400'));
        $this->assertSame(-13000, Money::source(-130));
        foreach (['1.005', '12.3400000001', '90071992547409.92', 'NaN'] as $value) {
            try {
                Money::source($value);
                $this->fail('Invalid source amount accepted');
            } catch (AccountingError $error) {
                $this->assertSame('invalid_source_amount', $error->errorCode);
            }
        }
    }
}
