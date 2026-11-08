<?php

namespace App\Console\Commands;

use App\Domain\Ledger\AccountingError;
use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\ProcessingBudget;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckProcessingReadiness extends Command
{
    protected $signature = 'tarjetas:readiness';

    protected $description = 'Read-only bounded local processing/database readiness on an approved synthetic target; does not migrate or repair';

    public function handle(TestTargetGuard $guard, PrivateProcess $process): int
    {
        $guard->check();
        try {
            PrivateRoots::assertDisjoint([
                (string) config('tarjetas.document_root'), (string) config('tarjetas.reference_root'),
                (string) (config('tarjetas.processing_temp_root') ?: config('tarjetas.test_target.temp_root')),
            ], []);
            foreach (['pdo_pgsql', 'mbstring', 'posix', 'zip'] as $extension) {
                if (! extension_loaded($extension)) {
                    throw new AccountingError('runtime_extension_missing');
                }
            }
            foreach (['receipt.cjs', 'reports.cjs'] as $bundle) {
                if (! is_file(base_path('processing/dist/'.$bundle))) {
                    throw new AccountingError('processing_build_missing');
                }
            }
            $probe = <<<'PYTHON'
import sys, json, subprocess
import psutil, pdfplumber, pymupdf
if sys.platform != 'darwin':
    raise SystemExit(3)
import Vision, Quartz
node = subprocess.run(['node', '--version'], capture_output=True, text=True, timeout=2, check=True).stdout.strip()
print(json.dumps({'platform': sys.platform, 'python': sys.version.split()[0], 'node': node, 'vision': True}))
PYTHON;
            $runtime = $process->json([config('tarjetas.python'), '-c', $probe], '', new ProcessingBudget(10000, 0));
            if (! str_starts_with($runtime['node'] ?? '', 'v24.') || ($runtime['vision'] ?? false) !== true) {
                throw new AccountingError('unsupported_processing_runtime');
            }
            DB::transaction(function (): void {
                DB::statement('SET TRANSACTION READ ONLY');
                DB::statement("SET LOCAL statement_timeout='2000ms'");
                DB::selectOne('SELECT 1 AS ready');
            });
            $this->line(json_encode(['ready' => true, 'scope' => 'local-synthetic', 'runtime' => $runtime, 'database' => 'reachable', 'productionIngressVerified' => false], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        } catch (\Throwable $error) {
            $this->line(json_encode(['ready' => false, 'scope' => 'local-synthetic', 'code' => $error instanceof AccountingError ? $error->errorCode : 'runtime_unavailable'], JSON_THROW_ON_ERROR));

            return self::FAILURE;
        }
    }
}
