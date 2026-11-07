<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\CatalogBootstrap;
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
}
