<?php

namespace App\Domain\Processing;

use App\Domain\Ledger\AccountingError;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/** All limits are monotonic. There is no production switch to disable a guard. */
class ProcessingBudget
{
    private float $last;

    private float $deadline;

    private float $nonOcr;

    private ?int $activeOcr = null;

    private array $ocr = [];

    private Closure $clock;

    public function __construct(float $remainingMs, float $nonOcrConsumedMs, ?Closure $monotonicClock = null)
    {
        if (! is_finite($remainingMs) || ! is_finite($nonOcrConsumedMs) || $nonOcrConsumedMs < 0) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        $this->clock = $monotonicClock ?? fn () => hrtime(true) / 1_000_000;
        $this->last = ($this->clock)();
        $this->deadline = $this->last + min(719000, $remainingMs);
        $this->nonOcr = max(0, $nonOcrConsumedMs);
        $this->check();
    }

    public static function fromIngress(Request $request): self
    {
        $metadata = [];
        foreach (['REQUEST_ID', 'STARTED_AT_UNIX_MS', 'DEADLINE_UNIX_MS', 'CLOCK_SKEW_MS'] as $key) {
            $metadata[$key] = $request->server->get('TARJETAS_INGRESS_'.$key);
        }
        $now = (int) floor(microtime(true) * 1000);
        if (! is_string($metadata['REQUEST_ID']) || ! Str::isUuid($metadata['REQUEST_ID']) || ! is_string($metadata['STARTED_AT_UNIX_MS']) || ! preg_match('/^\d{13}$/D', $metadata['STARTED_AT_UNIX_MS']) || ! is_string($metadata['DEADLINE_UNIX_MS']) || ! preg_match('/^\d{13}$/D', $metadata['DEADLINE_UNIX_MS']) || ! is_string($metadata['CLOCK_SKEW_MS']) || ! preg_match('/^-?\d{1,4}$/D', $metadata['CLOCK_SKEW_MS']) || abs((int) $metadata['CLOCK_SKEW_MS']) > 1000) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        $start = (int) $metadata['STARTED_AT_UNIX_MS'];
        $deadline = (int) $metadata['DEADLINE_UNIX_MS'];
        if ($deadline !== $start + 720000 || $start > $now + 1000) {
            throw new AccountingError('deadline_metadata_invalid');
        }

        return new self($deadline - $now - 1000, max(0, $now - $start));
    }

    public function check(): void
    {
        $now = ($this->clock)();
        $elapsed = max(0, $now - $this->last);
        if ($this->activeOcr === null) {
            $this->nonOcr += $elapsed;
        } else {
            $this->ocr[$this->activeOcr] += $elapsed;
        }
        $this->last = $now;
        if ($now >= $this->deadline) {
            throw new AccountingError('processing_timeout');
        }
        if ($this->activeOcr === null && $this->nonOcr >= 180000) {
            throw new AccountingError('non_ocr_budget_exceeded');
        }
        if ($this->activeOcr !== null && $this->ocr[$this->activeOcr] >= 180000) {
            throw new AccountingError('ocr_attempt_timeout');
        }
    }

    public function enterOcr(int $attempt): void
    {
        $this->check();
        if ($this->activeOcr !== null || $attempt < 1 || $attempt > 3 || ($attempt !== count($this->ocr) && $attempt !== count($this->ocr) + 1)) {
            throw new AccountingError('invalid_ocr_phase');
        }
        $this->ocr[$attempt] ??= 0;
        $this->activeOcr = $attempt;
    }

    public function leaveOcr(?float $workerEndedAt = null): void
    {
        $this->check();
        if ($this->activeOcr === null) {
            throw new AccountingError('invalid_ocr_phase');
        }
        if ($workerEndedAt !== null) {
            $delay = $this->last - $workerEndedAt;
            if (! is_finite($workerEndedAt) || $delay < 0 || $delay > 1000) {
                throw new AccountingError('deadline_metadata_invalid');
            }
            $charged = min($delay, $this->ocr[$this->activeOcr]);
            $this->ocr[$this->activeOcr] -= $charged;
            $this->nonOcr += $charged;
        }
        $this->activeOcr = null;
        $this->check();
    }

    public function assertNonOcr(): void
    {
        $this->check();
        if ($this->activeOcr !== null) {
            throw new AccountingError('invalid_processing_protocol');
        }
    }

    public function remainingMs(): float
    {
        $this->check();
        $phase = $this->activeOcr === null ? 180000 - $this->nonOcr : 180000 - $this->ocr[$this->activeOcr];

        return min($this->deadline - $this->last, $phase);
    }
}
