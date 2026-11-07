<?php

namespace Tests\Postgres;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class StatementApiTest extends PostgresTestCase
{
    public function test_exact_file_boundaries_are_checked_before_any_processing_and_ini_error_is_distinct_from_missing(): void
    {
        $ledger = Ledger::factory()->create();
        $this->actingAs($ledger->owner, 'web')->withHeader('Idempotency-Key', 'size-boundary');
        foreach (['statements' => 10485760, 'receipts' => 41943040] as $route => $limit) {
            foreach ([0, 1] as $extra) {
                $file = UploadedFile::fake()->createWithContent('boundary.pdf', '%PDF-'.str_repeat(' ', $limit + $extra - 5));
                $response = $this->post('/api/v1/'.$route, ['file' => $file, 'cardId' => 'synthetic-visa-a'], ['Accept' => 'application/json']);
                $response->assertStatus($extra === 0 ? 503 : 400)->assertJsonPath('error.code', $extra === 0 ? 'deadline_metadata_invalid' : 'too_large');
                unset($file);
            }
        }
        $file = new UploadedFile('', 'oversized.pdf', 'application/pdf', UPLOAD_ERR_INI_SIZE, true);
        $this->post('/api/v1/receipts', ['file' => $file], ['Accept' => 'application/json'])->assertStatus(400)->assertJsonPath('error.code', 'too_large');
        $this->post('/api/v1/receipts', [], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('file');
    }

    public function test_owned_statement_http_extraction_admission_replay_and_history(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python'), 'tarjetas.revision' => 'statement-http-acceptance']);
        $ledger = Ledger::factory()->create();
        $other = Ledger::factory()->create();
        $repository = new LedgerRepository($ledger);
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
        $now = (int) floor(microtime(true) * 1000);
        $this->withServerVariables(['TARJETAS_INGRESS_REQUEST_ID' => (string) Str::uuid(), 'TARJETAS_INGRESS_STARTED_AT_UNIX_MS' => (string) $now, 'TARJETAS_INGRESS_DEADLINE_UNIX_MS' => (string) ($now + 720000), 'TARJETAS_INGRESS_CLOCK_SKEW_MS' => '0']);
        $this->actingAs($ledger->owner, 'web');
        foreach (['visa' => 'synthetic-visa-a', 'mastercard' => 'synthetic-mastercard', 'mercadopago' => 'synthetic-mp'] as $brand => $card) {
            $json = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/'.$brand.'.expected.json')), true);
            $file = fn () => UploadedFile::fake()->createWithContent($json['file'], file_get_contents(base_path('../docs/rebuild/fixtures/pdf/'.$json['file'])));
            $response = $this->withHeader('Idempotency-Key', 'statement-'.$brand)->post('/api/v1/statements', ['file' => $file(), 'cardId' => $card], ['Accept' => 'application/json']);
            $response->assertOk()->assertJsonPath('duplicate', false);
            $expected = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/outcomes.json')), true)['imports'][$brand];
            $response->assertJsonCount($expected['purchases'], 'purchaseIds')->assertJsonCount($expected['journals'], 'postedJournalIds');
            $this->withHeader('Idempotency-Key', 'replay-'.$brand)->post('/api/v1/statements', ['file' => $file(), 'cardId' => $card], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('duplicate', true)->assertJsonCount(0, 'postedJournalIds');
        }
        $this->getJson('/api/v1/statements')->assertOk()->assertJsonPath('meta.total', 3);
        app('auth')->forgetGuards();
        $this->actingAs($other->owner, 'web')->getJson('/api/v1/statements')->assertOk()->assertJsonPath('meta.total', 0);
    }
}
