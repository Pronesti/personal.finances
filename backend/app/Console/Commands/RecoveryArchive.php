<?php

namespace App\Console\Commands;

use App\Domain\Recovery\OwnedRecovery;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class RecoveryArchive extends Command
{
    protected $signature = 'tarjetas:recovery {action : capture, inspect, restore, or reset-acceptance} {archive : Absolute private archive path} {--key-file= : Separate private file containing 32 random bytes} {--sha256= : Externally retained archive digest; required for inspect/restore} {--pg-bin= : Absolute canonical matching-major PostgreSQL binary directory}';

    protected $description = 'Guarded local acceptance of owner-aware administrator recovery; never selects or resets a target';

    public function handle(OwnedRecovery $recovery, TestTargetGuard $guard): int
    {
        $guard->check();
        $action = $this->argument('action');
        $result = match ($action) {
            'capture' => $recovery->capture($this->argument('archive'), (string) $this->option('key-file'), (string) $this->option('pg-bin')),
            'inspect' => (function () use ($recovery) {
                $checked = $recovery->inspect($this->argument('archive'), (string) $this->option('sha256'), (string) $this->option('key-file'));

                return ['status' => 'verified', 'format' => OwnedRecovery::FORMAT, 'references' => count($checked['manifest']['references']), 'identity' => 'authenticated protected component'];
            })(),
            'reset-acceptance' => $recovery->resetAcceptance($this->argument('archive'), (string) $this->option('sha256'), (string) $this->option('key-file')),
            'restore' => $recovery->restore($this->argument('archive'), (string) $this->option('sha256'), (string) $this->option('key-file'), (string) $this->option('pg-bin')),
            default => throw new \RuntimeException('recovery_action_invalid'),
        };
        $this->line(json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
