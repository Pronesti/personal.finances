<?php

namespace App\Console\Commands;

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Reports\ReferencePublisher;
use App\Domain\Reports\ReferenceTables;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class PublishReferences extends Command
{
    protected $signature = 'tarjetas:references {input? : Absolute complete local JSON containing cpi and mep maps} {--expected-current= : Current fingerprint, or empty for first publication into an empty root}';

    protected $description = 'Inspect or atomically publish local analytical references on an approved synthetic target; never fetch external data';

    public function handle(TestTargetGuard $guard, ReferenceTables $tables, ReferencePublisher $publisher): int
    {
        $guard->check();
        if ($this->argument('input') === null) {
            $data = $tables->read();
            $result = ['fingerprint' => FinancialCommands::digest($data), 'cpiLatestMonth' => array_key_last($data['cpi']), 'mepLatestMonth' => array_key_last($data['mep'])];
        } else {
            $result = $publisher->publish($this->argument('input'), (string) $this->option('expected-current'));
        }
        $this->line(json_encode($result, JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
