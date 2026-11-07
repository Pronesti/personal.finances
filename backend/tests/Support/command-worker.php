<?php

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->make(TestTargetGuard::class)->check();
$command = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$ledger = Ledger::findOrFail($command['ledger']);
$commands = new FinancialCommands(new LedgerRepository($ledger));
try {
    $result = match ($command['action']) {
        'purchase' => $commands->purchase($command['input']),
        'correct' => $commands->correct($command['input']),
    };
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (AccountingError $exception) {
    echo json_encode(['error' => $exception->errorCode], JSON_THROW_ON_ERROR);
}
