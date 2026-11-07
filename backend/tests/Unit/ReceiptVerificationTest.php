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
}
