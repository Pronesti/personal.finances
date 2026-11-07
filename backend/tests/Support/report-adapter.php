<?php

use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reports\ReportCalculator;
use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->make(TestTargetGuard::class)->check();
if (! $app->environment('testing')) {
    throw new RuntimeException('isolated_acceptance_required');
}
config(['tarjetas.python' => config('tarjetas.python') ?: base_path('.venv/bin/python')]);
$input = json_decode(file_get_contents('php://stdin'), true, flags: JSON_THROW_ON_ERROR);
$input['snapshot'] = true;
echo LedgerRepository::json($app->make(ReportCalculator::class)->calculate($input, new ProcessingBudget(30000, 0)));
