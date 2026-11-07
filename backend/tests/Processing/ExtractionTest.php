<?php

namespace Tests\Processing;

use App\Domain\Evidence\ReceiptVerification;
use App\Domain\Ledger\AccountingError;
use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\ProcessingBudget;
use Symfony\Component\Process\Process;
use Tests\PostgresTestCase;

class ExtractionTest extends PostgresTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
    }

    public function test_frozen_receipt_transcripts_are_extracted_privately_and_verified_in_php(): void
    {
        foreach (['receipt-valid.rows.txt' => true, 'receipt-one-cent-error.rows.txt' => false, 'receipt-corrected.rows.txt' => true] as $file => $accepted) {
            $parsed = app(PrivateProcess::class)->json(['node', base_path('processing/dist/receipt.cjs'), 'rows'], file_get_contents(base_path('../docs/rebuild/fixtures/'.$file)), new ProcessingBudget(719000, 0));
            $report = ReceiptVerification::verify($parsed);
            $this->assertSame($accepted, $report['ok']);
            $this->assertSame([8000, 5000], array_map(fn ($item) => $item['lineTotalCents'] + array_sum(array_column($item['discounts'], 'amountCents')), $parsed['items']));
            $this->assertSame(['un', 'un'], array_column($parsed['items'], 'unit'));
        }
    }

    public function test_complete_statement_envelopes_through_the_bounded_private_php_process_adapter(): void
    {
        foreach (['visa', 'mastercard', 'mercadopago'] as $brand) {
            $expected = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/'.$brand.'.expected.json')), true, flags: JSON_THROW_ON_ERROR);
            $actual = app(PrivateProcess::class)->json([config('tarjetas.python'), base_path('processing/statement.py'), base_path('../docs/rebuild/fixtures/pdf/'.$expected['file'])], '', new ProcessingBudget(719000, 0));
            $this->assertEquals($expected, $actual);
        }
    }

    public function test_private_helpers_do_not_inherit_application_credentials(): void
    {
        $keys = app(PrivateProcess::class)->json([config('tarjetas.python'), '-c', 'import os,json; print(json.dumps(sorted(os.environ)))'], '', new ProcessingBudget(719000, 0));
        foreach (['APP_KEY', 'DB_PASSWORD', 'DB_USERNAME', 'ANTHROPIC_API_KEY'] as $key) {
            $this->assertNotContains($key, $keys);
        }
    }

    public function test_normal_deadline_kills_and_reaps_a_private_processing_group(): void
    {
        $path = config('tarjetas.test_target.temp_root').'/cancel-'.bin2hex(random_bytes(12)).'.json';
        $code = 'import os,sys,json,subprocess; child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); open(sys.argv[1],"w").write(json.dumps([os.getpid(),child.pid])); child.wait()';
        try {
            app(PrivateProcess::class)->json([config('tarjetas.python'), '-c', $code, $path], '', new ProcessingBudget(500, 0));
            $this->fail('Timed-out worker returned successfully');
        } catch (AccountingError $error) {
            $this->assertSame('processing_timeout', $error->errorCode);
            $this->assertFileExists($path);
            $pids = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
            foreach ($pids as $pid) {
                $probe = new Process(['/bin/ps', '-o', 'stat=', '-p', (string) $pid]);
                $probe->run();
                $state = trim($probe->getOutput());
                $this->assertTrue($state === '' || str_starts_with($state, 'Z'), 'Processing descendant remained active after cancellation');
            }
        } finally {
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    public function test_actual_local_macos_vision_synthetic_pdf_reaches_the_exact_php_gate(): void
    {
        $budget = new ProcessingBudget(719000, 0);
        $boxes = app(PrivateProcess::class)->json([config('tarjetas.python'), base_path('processing/receipt_vision.py'), base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf'), '3', '1', config('tarjetas.test_target.temp_root')], '', $budget, true);
        $extraction = app(PrivateProcess::class)->json(['node', base_path('processing/dist/receipt.cjs'), 'boxes'], json_encode($boxes, JSON_THROW_ON_ERROR), $budget);
        $this->assertTrue(ReceiptVerification::verify($extraction['parsed'])['ok']);
        $this->assertSame(13000, $extraction['parsed']['footer']['totalCents']);
        $this->assertCount(2, $extraction['parsed']['items']);
    }
}
