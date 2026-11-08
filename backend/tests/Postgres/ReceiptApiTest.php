<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptRejected;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Models\Ledger;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class ReceiptApiTest extends PostgresTestCase
{
    public function test_http_receipt_retention_correction_and_cross_owner_access(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python'), 'tarjetas.revision' => 'receipt-http-acceptance']);
        $ledger = Ledger::factory()->create();
        $other = Ledger::factory()->create();
        $repository = new LedgerRepository($ledger);
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
        $service = new ReceiptService($repository, app(DocumentStore::class));
        $bytes = file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf'));
        $hash = hash('sha256', $bytes);
        try {
            $service->import(['key' => 'reject', 'bytes' => $bytes, 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-one-cent-error.rows.txt')), 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'receipt-http-acceptance'], new ProcessingBudget(719000, 0));
            $this->fail('Invalid receipt accepted');
        } catch (ReceiptRejected $error) {
            $id = $error->receiptPayload['receiptId'];
        }
        $this->actingAs($ledger->owner, 'web')->getJson('/api/v1/receipts')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.admission', 'rejected');
        $this->getJson('/api/v1/receipts/'.$id)->assertOk()->assertJsonPath('report.ok', false);
        $now = (string) (int) floor(microtime(true) * 1000);
        $this->withServerVariables(['TARJETAS_INGRESS_REQUEST_ID' => (string) Str::uuid(), 'TARJETAS_INGRESS_STARTED_AT_UNIX_MS' => $now, 'TARJETAS_INGRESS_DEADLINE_UNIX_MS' => (string) ((int) $now + 720000), 'TARJETAS_INGRESS_CLOCK_SKEW_MS' => '0']);
        $this->withHeader('Idempotency-Key', 'correction')->postJson('/api/v1/receipts/corrections/'.$hash, ['rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-one-cent-error.rows.txt'))])->assertUnprocessable()->assertJsonPath('error.code', 'verification_failed')->assertJsonPath('receiptId', $id)->assertJsonPath('report.ok', false)->assertJsonPath('sha256', $hash);
        $this->withHeader('Idempotency-Key', 'duplicate-rejected')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-one-cent-error.rows.txt'))])->assertUnprocessable()->assertJsonPath('error.code', 'verification_failed');
        $this->withHeader('Idempotency-Key', 'duplicate-rejected')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt'))])->assertConflict()->assertJsonPath('error.code', 'command_conflict');
        $this->withHeader('Idempotency-Key', 'corrected')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt'))])->assertOk()->assertJsonPath('receiptId', $id);
        $detail = $this->getJson('/api/v1/receipts/'.$id)->assertOk()->assertJsonPath('report.ok', true)->assertJsonPath('purchaseVersion', null)->assertJsonCount(3, 'history')->json();
        $rows = file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt'));
        $duplicate = $this->withHeader('Idempotency-Key', 'duplicate-accepted')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => $rows])->assertOk()->assertJsonPath('duplicate', true)->json();
        $this->withHeader('Idempotency-Key', 'duplicate-accepted')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => $rows])->assertOk()->assertJsonPath('sourceRevisionId', $duplicate['sourceRevisionId'])->assertJsonPath('duplicate', true);
        $this->withHeader('Idempotency-Key', 'duplicate-accepted')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => str_replace('SYNTHETIC RICE', 'SYNTHETIC ALTERED RICE', $rows)])->assertConflict()->assertJsonPath('error.code', 'command_conflict');
        $this->getJson('/api/v1/receipts/'.$id)->assertOk()->assertJsonCount(3, 'history');
        $this->assertSame(0, $repository->query('journals')->count());
        $this->withHeader('Idempotency-Key', 'initial-funding')->postJson('/api/v1/receipts/'.$id.'/reconciliation', ['receiptRevisionId' => $detail['revisionId'], 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'expectedPreviousDecisionId' => null, 'expectedPurchaseVersion' => null, 'allocation' => null])->assertOk();
        $this->getJson('/api/v1/receipts/'.$id)->assertOk()->assertJsonPath('purchaseVersion', 1);
        $missingFiscal = str_replace(' NRO.T.:9999-00000001', '', $rows);
        $failed = $this->withHeader('Idempotency-Key', 'missing-fiscal')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => $missingFiscal])->assertUnprocessable()->assertJsonPath('error.code', 'verification_failed')->assertJsonPath('receiptId', $id)->assertJsonPath('report.ok', false)->json();
        $this->withHeader('Idempotency-Key', 'missing-fiscal')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => $missingFiscal])->assertUnprocessable()->assertJsonPath('sourceRevisionId', $failed['sourceRevisionId']);
        $this->withHeader('Idempotency-Key', 'repair-fiscal')->postJson('/api/v1/receipts/corrections', ['sha256' => $hash, 'rowsText' => str_replace('SYNTHETIC RICE', 'SYNTHETIC RICE REPAIRED', $rows)])->assertOk()->assertJsonPath('receiptId', $id);
        $this->getJson('/api/v1/receipts/'.$id)->assertOk()->assertJsonCount(5, 'history')->assertJsonPath('revisionId', $detail['revisionId'])->assertJsonPath('purchaseVersion', 1);
        $this->assertSame(1, $repository->query('journals')->count());
        app('auth')->forgetGuards();
        $this->actingAs($other->owner, 'web')->getJson('/api/v1/receipts/'.$id)->assertNotFound();
        $this->getJson('/api/v1/documents/'.$hash)->assertNotFound();
        $this->withHeader('Idempotency-Key', 'foreign-correction')->postJson('/api/v1/receipts/corrections/'.$hash, ['rowsText' => 'foreign'])->assertNotFound();
        $this->getJson('/api/v1/receipts')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/receipt-charges')->assertOk()->assertJsonCount(0, 'receipts')->assertJsonCount(0, 'charges')->assertJsonCount(0, 'historicalHistory')->assertJsonCount(0, 'financialHistory');
    }

    public function test_history_pdf_correction_retains_its_own_document_original_transcript_and_scale(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python'), 'tarjetas.revision' => 'receipt-history-acceptance']);
        $ledger = Ledger::factory()->create();
        $repository = new LedgerRepository($ledger);
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
        $service = new ReceiptService($repository, app(DocumentStore::class));
        $bytes = file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf'));
        $rowsA = file_get_contents(base_path('../docs/rebuild/fixtures/receipt-valid.rows.txt'));
        $rowsB = str_replace('SYNTHETIC RICE', 'SYNTHETIC BEAN', $rowsA);
        $input = ['key' => 'pdf-a', 'bytes' => $bytes, 'rowsText' => $rowsA, 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'receipt-history-acceptance'];
        $a = $service->import($input, new ProcessingBudget(719000, 0));
        $bytesB = $bytes."\n% synthetic history PDF B";
        $hashB = hash('sha256', $bytesB);
        $b = $service->import([...$input, 'key' => 'pdf-b', 'bytes' => $bytesB, 'rowsText' => $rowsB, 'scale' => 2], new ProcessingBudget(719000, 0));
        $this->assertSame($a['receiptId'], $b['receiptId']);
        $this->assertSame('pending', $service->source($b['sourceRevisionId'])['admission']);
        $now = (string) (int) floor(microtime(true) * 1000);
        $this->withServerVariables(['TARJETAS_INGRESS_REQUEST_ID' => (string) Str::uuid(), 'TARJETAS_INGRESS_STARTED_AT_UNIX_MS' => $now, 'TARJETAS_INGRESS_DEADLINE_UNIX_MS' => (string) ((int) $now + 720000), 'TARJETAS_INGRESS_CLOCK_SKEW_MS' => '0']);
        $correctedRows = trim(str_replace('SYNTHETIC BEAN', 'SYNTHETIC BEAN REVIEWED', $rowsB));
        $result = $this->actingAs($ledger->owner, 'web')->withHeader('Idempotency-Key', 'correct-pdf-b')->postJson('/api/v1/receipts/corrections', ['sha256' => $hashB, 'rowsText' => $correctedRows])->assertOk()->assertJsonPath('receiptId', $a['receiptId'])->json();
        $source = $service->source($result['sourceRevisionId']);
        $facts = $service->facts($result['sourceRevisionId']);
        $this->assertSame($hashB, $source['documentHash']);
        $this->assertSame($b['sourceRevisionId'], $source['previousRevisionId']);
        $this->assertSame('pending', $source['admission']);
        $this->assertSame(2, $facts['scale']);
        $this->assertSame($rowsB, $service->readObject($facts['originalRowsObject']['sha256']));
        $this->assertSame($correctedRows, $service->readObject($facts['correctedRowsObject']['sha256']));
        $this->assertSame($bytesB, $service->readObject($hashB));
        $this->getJson('/api/v1/documents/'.$facts['originalRowsObject']['sha256'])->assertOk()->assertContent($rowsB);
        $this->getJson('/api/v1/receipts/'.$a['receiptId'])->assertOk()->assertJsonPath('revisionId', $a['sourceRevisionId'])->assertJsonPath('documentHash', hash('sha256', $bytes))->assertJsonCount(3, 'history');
        $this->withHeader('Idempotency-Key', 'correct-pdf-b')->postJson('/api/v1/receipts/corrections', ['sha256' => $hashB, 'rowsText' => $correctedRows])->assertOk()->assertJsonPath('duplicate', true)->assertJsonPath('sourceRevisionId', $result['sourceRevisionId']);
        $this->assertSame(0, $repository->query('journals')->count());
        app('auth')->forgetGuards();
        $this->actingAs(Ledger::factory()->create()->owner, 'web')->withHeader('Idempotency-Key', 'foreign-history')->postJson('/api/v1/receipts/corrections', ['sha256' => $hashB, 'rowsText' => $correctedRows])->assertNotFound();
        $this->getJson('/api/v1/documents/'.$facts['originalRowsObject']['sha256'])->assertNotFound();
    }

    public function test_upload_refuses_client_deadlines_before_starting_any_private_worker(): void
    {
        $ledger = Ledger::factory()->create();
        $this->actingAs($ledger->owner, 'web')->withHeader('Idempotency-Key', 'upload')->withHeader('TARJETAS-INGRESS-STARTED-AT-UNIX-MS', (string) (int) (microtime(true) * 1000))->post('/api/v1/receipts', ['file' => UploadedFile::fake()->createWithContent('synthetic.pdf', '%PDF-1.4 synthetic')], ['Accept' => 'application/json'])->assertStatus(503)->assertJsonPath('error.code', 'deadline_metadata_invalid');
        $this->assertSame(0, (new LedgerRepository($ledger))->query('source_revisions')->count());
    }
}
