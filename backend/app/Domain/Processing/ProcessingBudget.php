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

    private ?string $context = null;

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
        if (($existing = $request->attributes->get('processing_budget')) instanceof self) {
            $existing->check();

            return $existing;
        }
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

        $budget = new self($deadline - $now - 1000, max(0, $now - $start));
        $context = $request->server->get('TARJETAS_INGRESS_CONTEXT');
        if (is_string($context)) {
            $budget->context = $context;
            $budget->publish();
        }
        $request->attributes->set('processing_budget', $budget);

        return $budget;
    }

    public function check(): void
    {
        if ($this->context !== null) {
            clearstatcache(true, $this->context.'/cancelled');
        }
        if ($this->context !== null && is_file($this->context.'/cancelled')) {
            $code = file_get_contents($this->context.'/cancelled');
            throw new AccountingError(in_array($code, ['processing_timeout', 'non_ocr_budget_exceeded', 'ocr_attempt_timeout', 'client_disconnected'], true) ? $code : 'processing_timeout');
        }
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
        $this->publish();
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
        $this->publish();
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

    private function publish(): void
    {
        if ($this->context === null) {
            return;
        }
        $payload = json_encode(['clockMs' => $this->last, 'nonOcrMs' => $this->nonOcr, 'activeOcr' => $this->activeOcr, 'ocrMs' => $this->ocr], JSON_THROW_ON_ERROR);
        $path = $this->context.'/phase-'.bin2hex(random_bytes(8));
        $handle = fopen($path, 'xb');
        if ($handle === false) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        try {
            chmod($path, 0600);
            if (fwrite($handle, $payload) !== strlen($payload) || ! fflush($handle)) {
                throw new AccountingError('deadline_metadata_invalid');
            }
        } finally {
            fclose($handle);
        }
        if (! rename($path, $this->context.'/phase.json')) {
            @unlink($path);
            throw new AccountingError('deadline_metadata_invalid');
        }
    }
}
