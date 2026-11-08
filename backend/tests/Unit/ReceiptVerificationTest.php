<?php

namespace Tests\Unit;

use App\Domain\Evidence\ReceiptVerification;
use PHPUnit\Framework\TestCase;

class ReceiptVerificationTest extends TestCase
{
    public function test_php_gate_rejects_one_cent_difference_without_any_rounding_tolerance(): void
    {
        $receipt = ['header' => ['date' => '2026-01-15', 'fiscalNumber' => '9999-00000001'], 'notes' => [], 'items' => [
            ['position' => 1, 'qtyMilli' => 1000, 'unit' => 'un', 'lineTotalCents' => 10000, 'discounts' => [['tag' => 'M', 'amountCents' => -2000]]],
            ['position' => 2, 'qtyMilli' => 1000, 'unit' => 'un', 'lineTotalCents' => 5000, 'discounts' => []],
        ], 'footer' => ['subtotalCents' => 15000, 'discountsCents' => -2000, 'totalCents' => 13000, 'savingsCents' => 2000]];
        $this->assertTrue(ReceiptVerification::verify($receipt)['ok']);
        $receipt['footer']['totalCents'] = 13001;
        $report = ReceiptVerification::verify($receipt);
        $this->assertFalse($report['ok']);
        $this->assertSame(['name' => 'total', 'computed' => 13000, 'printed' => 13001, 'ok' => false], $report['checks'][2]);
    }

    public function test_exact_footer_totals_do_not_admit_a_negative_item_net(): void
    {
        foreach ([[-9999], [-10000], [-10001], [-6000, -5000]] as $discounts) {
            $sum = array_sum($discounts);
            $receipt = ['header' => ['date' => '2026-01-15', 'fiscalNumber' => '9999-00000001'], 'notes' => [], 'items' => [
                ['position' => 1, 'qtyMilli' => 1000, 'unit' => 'un', 'lineTotalCents' => 10000, 'discounts' => array_map(fn ($amount) => ['tag' => 'M', 'amountCents' => $amount], $discounts)],
                ['position' => 2, 'qtyMilli' => 1000, 'unit' => 'un', 'lineTotalCents' => 5000, 'discounts' => []],
            ], 'footer' => ['subtotalCents' => 15000, 'discountsCents' => $sum, 'totalCents' => 15000 + $sum, 'savingsCents' => -$sum]];
            $report = ReceiptVerification::verify($receipt);
            $this->assertSame($sum >= -10000, $report['ok']);
            $this->assertSame([true, true, true], array_column($report['checks'], 'ok'));
            $this->assertSame($sum >= -10000 ? [] : ['item 1 has a negative net amount'], $report['errors']);
        }
    }
}
