<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReportSnapshot;
use App\Models\Ledger;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class SourceClassificationTest extends PostgresTestCase
{
    public function test_historical_classification_is_owned_confirmed_versioned_and_never_posts_a_purchase(): void
    {
        $owners = [Ledger::factory()->create(), Ledger::factory()->create()];
        foreach ($owners as $index => $owner) {
            $repository = new LedgerRepository($owner);
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'historical-card', 'displayName' => 'Historical card']]);
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            (new FinancialCommands($repository))->post(['id' => Str::uuid()->toString(), 'commandKey' => 'opening', 'cardId' => 'historical-card', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 26000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'historical-card:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 26000, 'purchaseId' => null, 'purposeId' => null]]]);
            $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
            $raw->declared_totals = [];
            $raw->transactions = [];
            foreach ([15, 16] as $day) {
                $raw->transactions[] = (object) ['section' => 'purchases', 'date' => '2026-01-'.$day, 'description' => 'SYNTHETIC HISTORICAL PANTRY '.$day.' OWNER '.$index, 'ars' => 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => 'Original historical source'];
            }
            (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'historical', 'cardId' => 'historical-card', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')), 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'source-classification-test', 'observationOnly' => true]);
            app('auth')->forgetGuards();
            $this->actingAs($owner->owner, 'web');
            $rows = $this->getJson('/api/v1/merchant-review')->assertOk()->json('historical');
            $this->assertCount(2, $rows);
            $source = $rows[0]['sourceLineId'];
            $preview = $this->postJson('/api/v1/merchant-review/source-preview', ['sourceLineId' => $source, 'match' => 'SYNTHETIC HISTORICAL'])->assertOk()->json();
            $input = ['sourceLineId' => $source, 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'scope' => 'matching_history', 'match' => 'SYNTHETIC HISTORICAL', 'expectedPreviousDecisionId' => null, 'confirmedSourceLineIds' => array_column($preview['rows'], 'sourceLineId'), 'confirmHistory' => false, 'expectedFingerprint' => $preview['fingerprint']];
            $this->postJson('/api/v1/merchant-review/source-classification', $input, ['Idempotency-Key' => 'no-confirm'])->assertStatus(400)->assertJsonPath('error.code', 'history_confirmation_required');
            $input['confirmHistory'] = true;
            $this->postJson('/api/v1/merchant-review/source-classification', $input, ['Idempotency-Key' => 'confirmed'])->assertOk()->assertJsonCount(2, 'affectedSourceLineIds');
            $this->postJson('/api/v1/merchant-review/source-classification', $input, ['Idempotency-Key' => 'confirmed'])->assertOk()->assertJsonPath('duplicate', true);
            $this->postJson('/api/v1/merchant-review/source-classification', $input, ['Idempotency-Key' => 'stale'])->assertStatus(409);
            $facts = array_values(array_filter((new ReportSnapshot($repository))->read()['facts'], fn ($row) => $row['origin'] === 'historical_acquisition'));
            $this->assertSame(['food', 'food'], array_column($facts, 'purposeId'));
            $this->assertSame(26000, array_sum(array_column($facts, 'minor')));
            $this->assertSame(1, $repository->query('journals')->count());
            $this->assertSame(0, $repository->query('purchases')->count());
            $sources[] = $source;
        }
        app('auth')->forgetGuards();
        $this->actingAs($owners[0]->owner, 'web')->postJson('/api/v1/merchant-review/source-preview',['sourceLineId' => $sources[1], 'match' => 'SYNTHETIC'])->assertNotFound();
    }
}
