<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Recovery\LedgerIntegrity;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class LedgerIntegrityTest extends PostgresTestCase
{
    public function test_owned_integrity_finds_corrupt_bytes_without_mutating_them_or_leaking_to_the_other_owner(): void
    {
        $this->artisan('tarjetas:acceptance:references')->assertExitCode(0);
        $a = new LedgerRepository(Ledger::factory()->create());
        $b = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($a, []);
        app(CatalogBootstrap::class)->initialize($b, []);
        $store = app(DocumentStore::class);
        $object = $store->put($a->ledger, '%PDF-synthetic-integrity');
        $a->transaction(fn () => $a->insert('object_references', ['kind' => 'object', 'reference_id' => 'integrity-source', ...$object]));
        $checker = new LedgerIntegrity($a, $store);
        $this->assertTrue($checker->check()['integrityOk']);
        $this->assertSame(1, $checker->check()['objectReferenceCount']);
        $path = config('tarjetas.document_root').'/'.$object['relative_path'];
        file_put_contents($path, 'corrupt');
        try {
            $report = $checker->check();
            $this->assertFalse($report['integrityOk']);
            $this->assertFalse($report['releaseReady']);
            $this->assertSame('object_integrity', $report['issues'][0]['code']);
            $this->assertSame('corrupt', file_get_contents($path));
            $other = (new LedgerIntegrity($b, $store))->check();
            $this->assertTrue($other['integrityOk']);
            $this->assertSame(0, $other['objectReferenceCount']);
        } finally {
            file_put_contents($path, '%PDF-synthetic-integrity');
            chmod($path, 0600);
        }
        $this->assertTrue($checker->check()['integrityOk']);
    }

    public function test_release_check_refuses_references_that_cannot_value_this_owners_history(): void
    {
        $this->artisan('tarjetas:acceptance:references')->assertExitCode(0);
        $repository = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($repository, [['id' => 'synthetic-visa-a', 'displayName' => 'Synthetic Visa A']]);
        $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:anchor', 'kind' => 'synthetic', 'metadata' => '{}']));
        (new FinancialCommands($repository))->purchase(['key' => 'synthetic:future-anchor', 'purchaseId' => 'purchase:anchor', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-04-15', 'recordedAt' => '2026-04-15T12:00:00Z', 'evidenceIds' => ['synthetic:anchor'], 'principalMinor' => 100, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 100]]]);
        $report = (new LedgerIntegrity($repository, app(DocumentStore::class)))->check();
        $this->assertFalse($report['releaseReady']);
        $this->assertContains('references_too_old', array_column($report['issues'], 'code'));
        $this->assertSame(1, $report['journalCount']);
        $other = new LedgerRepository(Ledger::factory()->create());
        $this->assertTrue((new LedgerIntegrity($other, app(DocumentStore::class)))->check()['releaseReady']);
    }
}
