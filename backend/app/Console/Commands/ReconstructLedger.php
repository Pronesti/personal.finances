<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Recovery\PortableReconstruction;
use App\Models\Ledger;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class ReconstructLedger extends Command
{
    protected $signature = 'tarjetas:reconstruct {manifest : Explicit portable synthetic JSON under the approved private temp root} {--ledger= : Existing fresh factory ledger UUID}';

    protected $description = 'Retain portable synthetic provenance and rehearse historical/opening admission on an explicitly guarded ledger';

    public function handle(TestTargetGuard $guard, DocumentStore $documents): int
    {
        $guard->check();
        $id = $this->option('ledger');
        if (! is_string($id) || ! Str::isUuid($id)) {
            throw new \RuntimeException('explicit_factory_ledger_required');
        }
        $ledger = Ledger::query()->findOrFail($id);
        if (! preg_match('/^synthetic-[A-Za-z0-9.-]+@example\.invalid$/D', $ledger->owner->email)) {
            throw new \RuntimeException('synthetic_factory_identity_required');
        }
        $report = (new PortableReconstruction(new LedgerRepository($ledger), $documents))->execute($this->argument('manifest'));
        $this->line(json_encode($report, JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
