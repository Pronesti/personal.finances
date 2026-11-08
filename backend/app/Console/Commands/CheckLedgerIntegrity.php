<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Recovery\LedgerIntegrity;
use App\Models\Ledger;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class CheckLedgerIntegrity extends Command
{
    protected $signature = 'tarjetas:integrity {ledger : Explicit ledger UUID} {--release-check : Also fail for unresolved reviews or incomplete reconstruction}';

    protected $description = 'Read-only owner-qualified integrity and local release admission checks on an approved synthetic PostgreSQL target';

    public function handle(TestTargetGuard $guard, DocumentStore $documents): int
    {
        $guard->check();
        $ledger = Ledger::query()->findOrFail($this->argument('ledger'));
        $report = (new LedgerIntegrity(new LedgerRepository($ledger), $documents))->check();
        $this->line(json_encode($report, JSON_THROW_ON_ERROR));

        return ($this->option('release-check') ? $report['releaseReady'] : $report['integrityOk']) ? self::SUCCESS : self::FAILURE;
    }
}
