<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReferenceTables;
use App\Domain\Reports\ReportSnapshot;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class ReportOwnershipTest extends PostgresTestCase
{
    public function test_owned_postgres_facts_native_sentinels_and_direct_report_endpoints(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $rates = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true);
        $reference = $this->createMock(ReferenceTables::class);
        $reference->method('read')->willReturn($rates);
        $this->app->instance(ReferenceTables::class, $reference);
        foreach ([105, 203] as $sentinel) {
            $ledger = Ledger::factory()->create();
            $repository = new LedgerRepository($ledger);
            app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
            $raw->declared_totals = [];
            $raw->transactions = [(object) ['section' => 'purchases', 'date' => '2026-01-15', 'description' => 'SYNTHETIC SENTINEL '.$sentinel, 'ars' => $sentinel, 'usd' => null, 'installment_count' => null, 'installment_number' => null, 'raw_line' => 'synthetic']];
            (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'report-sentinel', 'cardId' => 'synthetic-visa-a', 'filename' => 'synthetic_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')), 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-01T12:00:00Z', 'appRevision' => 'report-acceptance']);
            $snapshot = (new ReportSnapshot($repository))->read();
            $this->assertSame(['2026-01'], $snapshot['months']);
            $purchase = array_values(array_filter($snapshot['facts'], fn ($fact) => $fact['kind'] === 'purchase'));
            $this->assertCount(1, $purchase);
            $this->assertSame($sentinel * 100, $purchase[0]['minor']);
            $this->assertSame('SYNTHETIC SENTINEL '.$sentinel, $purchase[0]['merchant']);
            app('auth')->forgetGuards();
            $this->actingAs($ledger->owner, 'web');
            $this->getJson('/api/v1/reports/trends?value=nominal')->assertOk()->assertJsonPath('data.spending.total', $sentinel)->assertJsonPath('meta.scope.basis', 'purchase');
            $this->getJson('/api/v1/reports/trends?value=nominal&spend=cash')->assertOk()->assertJsonPath('data.spending.total', $sentinel)->assertJsonPath('meta.scope.basis', 'billed');
            $this->getJson('/api/v1/reports/categories?value=invalid&g=invalid&period=invalid')->assertOk()->assertJsonPath('meta.scope.value', 'real')->assertJsonPath('meta.scope.granularity', 'month')->assertJsonPath('meta.scope.period', '2026-01')->assertJsonPath('meta.nativePurpose.from', '2026-01-01')->assertJsonPath('meta.nativePurpose.to', '2026-01-31');
            $native = $this->getJson('/api/v1/reports/categories?value=nominal')->assertOk()->json('meta.nativePurpose.measures');
            $visa = array_values(array_filter($native, fn ($row) => $row['cardId'] === 'synthetic-visa-a' && $row['currency'] === 'ARS'))[0];
            $this->assertSame((string) ($sentinel * 100), $visa['rows'][0]['expenseMinor']);
            $this->assertSame((string) ($sentinel * 100), $visa['rows'][0]['debtMinor']);
            $this->getJson('/api/v1/reports/merchants?value=nominal&period=invalid')->assertOk()->assertJsonPath('meta.scope.period', 'all');
            $this->getJson('/api/v1/reports/trends?ledger_id=22222222-2222-4222-8222-222222222222')->assertStatus(400);
            $this->getJson('/api/v1/reports/does-not-exist')->assertNotFound();
        }
    }

    public function test_empty_owner_report_does_not_require_reference_files_or_other_owners_data(): void
    {
        $ledger = Ledger::factory()->create();
        $this->actingAs($ledger->owner, 'web')->getJson('/api/v1/reports/overview')->assertOk()->assertJsonPath('meta.empty', true)->assertJsonPath('data', null);
    }
}
