<?php

namespace App\Console\Commands;

use App\Domain\Recovery\OwnedRecovery;
use App\Models\Ledger;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class LedgerExport extends Command
{
    protected $signature = 'tarjetas:ledger-export {ledger : Explicit immutable ledger UUID} {output : New absolute private ZIP path}';

    protected $description = 'Guarded single-ledger financial export without users, authentication or other owners';

    public function handle(OwnedRecovery $recovery, TestTargetGuard $guard): int
    {
        $guard->check();
        $ledger = Ledger::query()->findOrFail($this->argument('ledger'));
        $this->line(json_encode($recovery->export($ledger, $this->argument('output')), JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
