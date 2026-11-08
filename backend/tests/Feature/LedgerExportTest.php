<?php

namespace Tests\Feature;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Tests\PostgresTestCase;
use ZipArchive;

class LedgerExportTest extends PostgresTestCase
{
    public function test_financial_export_is_scoped_and_omits_all_authentication_rows(): void
    {
        $a = Ledger::factory()->create();
        $b = Ledger::factory()->create();
        foreach ([$a, $b] as $ledger) {
            app(CatalogBootstrap::class)->initialize(new LedgerRepository($ledger), []);
        }
        $this->actingAs($a->owner, 'web')->get('/api/v1/exports/ledger?ledger_id='.$b->id, ['Accept' => 'application/json'])->assertStatus(400);
        $response = $this->get('/api/v1/exports/ledger', ['Accept' => 'application/json'])->assertOk()->assertHeader('Content-Type', 'application/zip')->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $file = $response->baseResponse->getFile()->getPathname();
        $zip = new ZipArchive;
        $zip->open($file);
        try {
            $rows = json_decode($zip->getFromName('financial.json'), true);
            $this->assertSame($a->id, $rows['ledgerId']);
            $this->assertArrayNotHasKey('users', $rows['tables']);
            $this->assertArrayNotHasKey('sessions', $rows['tables']);
            $this->assertFalse($zip->locateName('identity.enc'));
            foreach ($rows['tables'] as $table) {
                foreach ($table as $row) {
                    $this->assertSame($a->id, $row['ledger_id']);
                }
            }
        } finally {
            $zip->close();
            unlink($file);
        }
    }
}
