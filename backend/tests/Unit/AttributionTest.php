<?php

namespace Tests\Unit;

use App\Domain\Ledger\Attribution;
use PHPUnit\Framework\TestCase;

class AttributionTest extends TestCase
{
    public function test_frozen_ordering_explicit_partial_and_later_issuer_reservation(): void
    {
        $fixture = json_decode(file_get_contents(dirname(__DIR__, 3).'/docs/rebuild/fixtures/algorithm-cases.json'), true);
        $oldest = $fixture['oldestBilled'];
        $this->assertSame($oldest['expected'], Attribution::oldest($oldest['amountMinor'], $oldest['components']));
        foreach (['partialIssuer', 'reservedIssuer'] as $key) {
            $case = $fixture[$key];
            $this->assertEquals($case['expected'], Attribution::replay(['billings' => $case['billings'], 'payments' => $case['payments'], 'credits' => [], 'componentRevisions' => []]));
        }
    }

    public function test_an_empty_latest_revision_suppresses_old_attributions(): void
    {
        $bill = ['id' => 'b', 'purchaseId' => 'p', 'cardId' => 'c', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'purchaseDate' => '2026-01-01', 'components' => [['id' => 'x', 'purposeId' => 'food', 'minor' => 100]]];
        $rows = [['paymentId' => 'payment', 'componentId' => 'x', 'revision' => 1, 'minor' => 100]];
        $outstanding = Attribution::outstanding([$bill], $rows, [], [], [['paymentId' => 'payment', 'revision' => 2, 'unappliedMinor' => 100]]);
        $this->assertSame(100, $outstanding[0]['outstandingMinor']);
    }
}
