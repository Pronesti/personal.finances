<?php

namespace App\Domain\Processing;

use App\Domain\Ledger\AccountingError;
use Symfony\Component\Process\Process;
use Throwable;

class PrivateProcess
{
    public function json(array $command, string $input, ProcessingBudget $budget, bool $phaseProtocol = false): array
    {
        $python = config('tarjetas.python');
        if (! is_string($python) || $python === '' || ! is_executable($python)) {
            throw new AccountingError('python_missing');
        }
        $process = new Process([$python, base_path('processing/launch.py'), ...$command], base_path('processing'), [
            'PATH' => getenv('PATH') ?: '', 'HOME' => getenv('HOME') ?: '', 'LC_ALL' => 'en_US.UTF-8',
            'APP_KEY' => false, 'DB_PASSWORD' => false, 'ANTHROPIC_API_KEY' => false,
        ]);
        // Symfony inherits otherwise-unlisted variables; disable every inherited value first.
        $allowed = ['PATH', 'HOME', 'LC_ALL'];
        $environment = [];
        foreach (array_unique(array_merge(array_keys($_SERVER), array_keys($_ENV), array_keys(getenv()))) as $key) {
            if (! in_array($key, $allowed, true)) {
                $environment[$key] = false;
            }
        }
        $process->setEnv([...$environment, 'PATH' => getenv('PATH') ?: '', 'HOME' => getenv('HOME') ?: '', 'LC_ALL' => 'en_US.UTF-8']);
        $process->setInput($input);
        $process->setTimeout(null);
        $stdout = '';
        $stderr = '';
        $pending = '';
        $result = null;
        $groupId = null;
        try {
            $budget->check();
            $process->start(function (string $type, string $bytes) use (&$stdout, &$stderr, &$pending, &$result, $phaseProtocol, $budget): void {
                if ($type === Process::ERR) {
                    $stderr .= $bytes;
                    if (strlen($stderr) > 65536) {
                        throw new AccountingError('processing_output_limit');
                    }

                    return;
                }
                $stdout .= $bytes;
                if (strlen($stdout) > 4 * 1024 * 1024) {
                    throw new AccountingError('processing_output_limit');
                }
                if ($phaseProtocol) {
                    $pending .= $bytes;
                    while (($newline = strpos($pending, "\n")) !== false) {
                        $line = substr($pending, 0, $newline);
                        $pending = substr($pending, $newline + 1);
                        $event = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
                        if ($result !== null) {
                            throw new AccountingError('invalid_processing_protocol');
                        }
                        if (($event['event'] ?? null) === 'ocr_start') {
                            $budget->enterOcr($event['attempt']);
                        } elseif (($event['event'] ?? null) === 'ocr_end') {
                            $budget->leaveOcr($event['monotonic_ms']);
                        } elseif (($event['event'] ?? null) === 'result') {
                            $result = $event['value'];
                        } else {
                            throw new AccountingError('invalid_processing_protocol');
                        }
                    }
                }
            });
            $groupId = $process->getPid();
            while ($process->isRunning()) {
                $budget->check();
                usleep(10000);
            }
            $process->wait();
            $budget->check();
            if (! $process->isSuccessful()) {
                $failure = json_decode(trim($stderr), true);
                $code = $failure['code'] ?? null;
                $allowed = ['parser_layout_error', 'parser_read_error', 'receipt_processing_failed', 'processing_memory_limit'];
                throw new AccountingError($process->getExitCode() === 3 ? 'ocr_unavailable' : (in_array($code, $allowed, true) ? $code : 'parser_failed'));
            }
            $budget->assertNonOcr();
            $decoded = $phaseProtocol ? $result : json_decode($stdout, true, flags: JSON_THROW_ON_ERROR);
            if (! is_array($decoded)) {
                throw new AccountingError('invalid_processing_output');
            }

            return $decoded;
        } catch (Throwable $error) {
            $pid = $groupId ?? $process->getPid();
            if ($pid !== null) {
                @posix_kill(-$pid, SIGTERM);
                usleep(50000);
                @posix_kill(-$pid, SIGKILL);
                $process->stop(0, SIGKILL);
            }
            throw $error;
        }
    }
}
