<?php

namespace Tests\Feature;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Models\Ledger;
use Illuminate\Http\Request;
use Symfony\Component\Process\Process;
use Tests\PostgresTestCase;

/** Exact injected-clock semantics complement, and never replace, real first-byte/FPM wall-clock tests. */
class DeadlineAdmissionTest extends PostgresTestCase
{
    public function test_all_normal_frozen_phase_cases_gate_actual_owned_postgresql_admission(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('../docs/rebuild/deadline-fixtures.json')), true);
        $cases = array_values(array_filter($fixtures['cases'], fn ($case) => $case['mode'] === 'normal'));
        $this->assertCount(16, $cases);
        foreach ($cases as $case) {
            $r = new LedgerRepository(Ledger::factory()->create());
            app(CatalogBootstrap::class)->initialize($r, [['id' => 'deadline-card', 'displayName' => 'Synthetic']]);
            $r->transaction(fn () => $r->insert('evidence', ['id' => 'deadline-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            $time = $case['upload_ms'] + $case['upstream_queue_ms'];
            $consumed = $time;
            $attempts = 0;
            $backend = false;
            $code = 'ok';
            $status = 200;
            $probe = new Process(['node', '--input-type=module', '-e', "import {phaseExpiry} from './ingress/server.mjs';console.log(JSON.stringify(phaseExpiry(0,Number(process.argv[1]),process.argv[2]==='true')));", (string) min($case['upload_ms'], 180000), $case['upload_ms'] < 180000 ? 'true' : 'false'], base_path());
            $probe->mustRun();
            $edge = json_decode(trim($probe->getOutput()), true);
            if ($edge !== null) {
                $status = $edge['status'];
                $code = $edge['code'];
                $time = 180000;
                $consumed = 180000;
            } elseif ($time >= 180000) {
                $time = 180000;
                $consumed = 180000;
                $status = 504;
                $code = 'non_ocr_budget_exceeded';
            } else {
                $backend = true;
                try {
                    if ($case['trusted_metadata'] !== 'valid') {
                        $now = (int) floor(microtime(true) * 1000);
                        $server = ['TARJETAS_INGRESS_REQUEST_ID' => '11111111-1111-4111-8111-111111111111', 'TARJETAS_INGRESS_STARTED_AT_UNIX_MS' => (string) ($now - $time), 'TARJETAS_INGRESS_DEADLINE_UNIX_MS' => (string) ($now - $time + 720001), 'TARJETAS_INGRESS_CLOCK_SKEW_MS' => '0'];
                        if ($case['trusted_metadata'] === 'missing') {
                            $server = [];
                        }ProcessingBudget::fromIngress(Request::create('/api/v1/receipts', 'POST', server: $server));
                        $this->fail('Invalid metadata admitted');
                    }
                    $budget = new ProcessingBudget(719000 - $time, $time, function () use (&$time) {
                        return $time;
                    });
                    foreach ([...$case['processing_phases'], ['kind' => 'non_ocr', 'duration_ms' => $case['cleanup_ms']]] as $phase) {
                        $ocr = $phase['kind'] === 'ocr';
                        if ($ocr) {
                            $budget->enterOcr($phase['attempt']);
                            $attempts++;
                        }$duration = min($phase['duration_ms'], $budget->remainingMs());
                        $time += $duration;
                        if (! $ocr) {
                            $consumed += $duration;
                        }$budget->check();
                        if ($ocr) {
                            $budget->leaveOcr();
                        }
                    }
                    $budget->assertNonOcr();
                    (new FinancialCommands($r))->purchase(['key' => 'deadline-post', 'purchaseId' => 'deadline-purchase', 'cardId' => 'deadline-card', 'currency' => 'ARS', 'principalMinor' => 10500, 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-16T00:00:00Z', 'evidenceIds' => ['deadline-proof'], 'allocations' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 10500]]]);
                } catch (AccountingError $error) {
                    $code = $error->errorCode;
                    $status = $code === 'deadline_metadata_invalid' ? 503 : 504;
                }
            }
            $expected = $case['expected'];
            $this->assertSame($expected['status'], $status, $case['name']);
            $this->assertSame($expected['code'], $code, $case['name']);
            $this->assertSame($expected['backend_started'], $backend, $case['name']);
            $this->assertEquals($expected['finished_elapsed_ms'], $time, $case['name']);
            $this->assertEquals($expected['non_ocr_consumed_ms'], $consumed, $case['name']);
            $this->assertSame($expected['ocr_attempts_started'], $attempts, $case['name']);
            $this->assertSame($expected['financial_postings'], $r->query('journals')->count(), $case['name']);
        }
    }

    public function test_four_frozen_watchdog_fault_cases_use_only_the_isolated_adapter(): void
    {
        $cases = array_values(array_filter(json_decode(file_get_contents(base_path('../docs/rebuild/deadline-fixtures.json')), true)['cases'], fn ($case) => $case['mode'] === 'outer_watchdog_fault_injection'));
        $this->assertCount(4, $cases);
        foreach ($cases as $case) {
            $r = new LedgerRepository(Ledger::factory()->create());
            app(CatalogBootstrap::class)->initialize($r, [['id' => 'fault-card', 'displayName' => 'Synthetic isolated fault']]);
            $r->transaction(fn () => $r->insert('evidence', ['id' => 'fault-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            $probe = new Process(['node', '--input-type=module', '-e', "import {watchdogExpiry} from './tests/Support/watchdog-fault.mjs';const c=JSON.parse(process.argv[1]);const upload=watchdogExpiry(0,c.upload_ms,false);const end=c.upload_ms+c.upstream_queue_ms+c.requested_processing_ms+c.cleanup_ms;const failure=upload??watchdogExpiry(0,end,true);console.log(JSON.stringify({failure,finish:upload?180000:failure?720000:end}));", json_encode($case, JSON_THROW_ON_ERROR)], base_path());
            $probe->mustRun();
            $actual = json_decode(trim($probe->getOutput()), true);
            $this->assertSame($case['expected']['status'], $actual['failure']['status'] ?? 200);
            $this->assertSame($case['expected']['code'], $actual['failure']['code'] ?? 'ok');
            $this->assertSame($case['expected']['finished_elapsed_ms'], $actual['finish']);
            if ($actual['failure'] === null) {
                // This intentionally isolated test is the only fixture admission without a production processing budget.
                (new FinancialCommands($r))->purchase(['key' => 'isolated-fault', 'purchaseId' => 'isolated-fault-purchase', 'cardId' => 'fault-card', 'currency' => 'ARS', 'principalMinor' => 10500, 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-16T00:00:00Z', 'evidenceIds' => ['fault-proof'], 'allocations' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 10500]]]);
                $time = 0;
                $normal = new ProcessingBudget(719000, 179999, function () use (&$time) {
                    return $time;
                });
                $time = 1;
                try {
                    $normal->check();
                    $this->fail('Normal production guard was bypassed');
                } catch (AccountingError $error) {
                    $this->assertSame('non_ocr_budget_exceeded', $error->errorCode);
                }
            }
            $this->assertSame($case['expected']['financial_postings'], $r->query('journals')->count());
        }
    }
}
