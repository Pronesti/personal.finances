<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReportSnapshot;
use App\Domain\Reviews\MerchantReviews;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class MerchantReviewWorkflowsTest extends PostgresTestCase
{
    private function statement(LedgerRepository $repository, string $name, string $date, string $key): array
    {
        $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
        $raw->period->closing_date = (new \DateTimeImmutable($date))->modify('last day of next month')->format('Y-m-d');
        $raw->transactions = [(object) ['section' => 'purchases', 'block' => 1, 'date' => $date, 'description' => $name, 'voucher' => $key, 'ars' => 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => $name.' 130,00']];
        $raw->declared_totals = [];

        return (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => $key, 'cardId' => 'merchant-card', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf'))."\n%synthetic-".$key, 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'merchant-test']);
    }

    public function test_selected_future_and_confirmed_history_scopes_are_isolated_and_preserve_native_principal(): void
    {
        $owners = [Ledger::factory()->create(), Ledger::factory()->create()];
        foreach ($owners as $owner) {
            $repository = new LedgerRepository($owner);
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'merchant-card', 'displayName' => 'Merchant card']]);
            $first = $this->statement($repository, 'SYNTHETIC PANTRY ONE', '2026-01-15', 'first');
            $second = $this->statement($repository, 'SYNTHETIC PANTRY TWO', '2026-02-16', 'second');
            app('auth')->forgetGuards();
            $this->actingAs($owner->owner, 'web');
            $queue = $this->getJson('/api/v1/merchant-review')->assertOk()->json();
            $this->assertCount(2, $queue['purchases']);
            $id = $first['purchaseIds'][0];
            $body = ['kind' => 'purchase_classification', 'purchaseId' => $id, 'cardId' => 'merchant-card', 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'scope' => 'future_rule', 'match' => 'SYNTHETIC PANTRY', 'expectedVersion' => 1];
            $journals = $repository->query('journals')->count();
            $this->postJson('/api/v1/merchant-review', $body, ['Idempotency-Key' => 'future'])->assertOk()->assertJsonPath('affectedPurchaseIds', []);
            $this->assertSame(1, $repository->purchase($id)['version']);
            $this->assertSame($journals, $repository->query('journals')->count());
            $third = $this->statement($repository, 'SYNTHETIC PANTRY THREE', '2026-03-17', 'third');
            $this->assertSame('food', $repository->purchase($third['purchaseIds'][0])['allocations'][0]['purposeId']);
            $preview = $this->postJson('/api/v1/merchant-review/preview', ['cardId' => 'merchant-card', 'match' => 'SYNTHETIC PANTRY'])->assertOk()->json();
            $this->assertCount(3, $preview['versions']);
            $history = [...$body, 'scope' => 'matching_history', 'confirmedPurchaseIds' => array_column($preview['versions'], 'purchaseId'), 'confirmHistory' => false, 'expectedFingerprint' => $preview['fingerprint']];
            $this->postJson('/api/v1/merchant-review', $history, ['Idempotency-Key' => 'unconfirmed'])->assertStatus(400)->assertJsonPath('error.code', 'history_confirmation_required');
            $this->assertSame(1, $repository->purchase($id)['version']);
            $history['confirmHistory'] = true;
            $this->postJson('/api/v1/merchant-review', $history, ['Idempotency-Key' => 'history'])->assertOk()->assertJsonCount(3, 'affectedPurchaseIds');
            $this->postJson('/api/v1/merchant-review', $history, ['Idempotency-Key' => 'history', 'Accept-Language' => 'es'])->assertOk()->assertJsonPath('duplicate', true);
            $this->assertSame(2, $repository->purchase($id)['version']);
            $this->assertSame(13000, $repository->purchase($id)['principalMinor']);
            $stale = [...$history, 'expectedVersion' => 2];
            $this->postJson('/api/v1/merchant-review', $stale, ['Idempotency-Key' => 'stale-history'])->assertStatus(400)->assertJsonPath('error.code', 'history_confirmation_required');
            $selected = [...$body, 'scope' => 'selected', 'match' => null, 'expectedVersion' => 2, 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home'];
            $this->postJson('/api/v1/merchant-review', $selected, ['Idempotency-Key' => 'selected'])->assertOk()->assertJsonPath('affectedPurchaseIds', [$id]);
            $this->assertSame('home', $repository->purchase($id)['allocations'][0]['purposeId']);
            $this->assertSame('food', $repository->purchase($second['purchaseIds'][0])['allocations'][0]['purposeId']);
            $before = $repository->query('journals')->count();
            $merchants = (new MerchantReviews($repository))->current('merchant_revisions');
            $merge = ['kind' => 'merchant_merge', 'sourceId' => $merchants[0]['id'], 'targetId' => $merchants[1]['id'], 'expectedSeq' => $merchants[0]['seq']];
            $this->postJson('/api/v1/merchant-review', $merge, ['Idempotency-Key' => 'merge'])->assertOk();
            $this->assertSame($before, $repository->query('journals')->count());
            $merged = (new MerchantReviews($repository))->resolve($merchants[0]['normalizedName']);
            $this->assertSame($merchants[1]['id'], $merged['id']);
            $snapshot = (new ReportSnapshot($repository))->read();
            $this->assertNotContains($merchants[0]['normalizedName'], array_column($snapshot['facts'], 'merchant'));
            $exclusive[] = $id;
        }
        app('auth')->forgetGuards();
        $this->actingAs($owners[0]->owner, 'web')->postJson('/api/v1/merchant-review', ['kind' => 'purchase_classification', 'purchaseId' => $exclusive[1], 'cardId' => 'merchant-card', 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'scope' => 'selected', 'match' => null, 'expectedVersion' => 1], ['Idempotency-Key' => 'foreign'])->assertNotFound();
    }
}
