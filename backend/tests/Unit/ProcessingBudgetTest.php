<?php

namespace Tests\Unit;

use App\Domain\Ledger\AccountingError;
use App\Domain\Processing\ProcessingBudget;
use Illuminate\Http\Request;
use PHPUnit\Framework\TestCase;

class ProcessingBudgetTest extends TestCase
{
    public function test_successful_long_path_pauses_only_active_ocr_and_keeps_original_deadline(): void
    {
        $time = 0;
        $budget = new ProcessingBudget(589000, 130000, function () use (&$time) {
            return $time;
        });
        $time += 10000;
        $budget->check();
        foreach ([1, 2, 3] as $attempt) {
            $budget->enterOcr($attempt);
            $time += 160000;
            $budget->leaveOcr();
        }
        $time += 20000;
        $budget->check();
        $this->assertSame(20000.0, $budget->remainingMs());
    }

    public function test_upload_queue_render_and_cleanup_share_the_same_non_ocr_counter(): void
    {
        $time = 0;
        $budget = new ProcessingBudget(599000, 120000, function () use (&$time) {
            return $time;
        });
        $time = 59000;
        $budget->check();
        $time = 60000;
        $this->expectException(AccountingError::class);
        $this->expectExceptionMessage('non_ocr_budget_exceeded');
        $budget->check();
    }

    public function test_attempt_time_is_cumulative_across_slices(): void
    {
        $time = 0;
        $budget = new ProcessingBudget(700000, 0, function () use (&$time) {
            return $time;
        });
        $budget->enterOcr(1);
        $time = 100000;
        $budget->leaveOcr();
        $time += 1000;
        $budget->enterOcr(1);
        $time += 80000;
        $this->expectExceptionMessage('ocr_attempt_timeout');
        $budget->check();
    }

    public function test_original_request_has_priority_over_an_equal_phase_deadline(): void
    {
        $time = 0;
        $budget = new ProcessingBudget(1000, 179000, function () use (&$time) {
            return $time;
        });
        $time = 1000;
        $this->expectExceptionMessage('processing_timeout');
        $budget->check();
    }

    public function test_client_headers_cannot_supply_protected_ingress_metadata(): void
    {
        $request = Request::create('/api/v1/receipts/import', 'POST', server: ['HTTP_TARJETAS_INGRESS_STARTED_AT_UNIX_MS' => (string) floor(microtime(true) * 1000), 'HTTP_TARJETAS_INGRESS_DEADLINE_UNIX_MS' => '9999999999999']);
        $this->expectExceptionMessage('deadline_metadata_invalid');
        ProcessingBudget::fromIngress($request);
    }

    public function test_delayed_phase_delivery_is_charged_back_to_non_ocr_work(): void
    {
        $time = 0;
        $budget = new ProcessingBudget(600000, 179900, function () use (&$time) {
            return $time;
        });
        $budget->enterOcr(1);
        $time = 1000;
        $this->expectExceptionMessage('non_ocr_budget_exceeded');
        $budget->leaveOcr(900);
    }
}
