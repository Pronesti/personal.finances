<?php

namespace App\Console\Commands;

use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class CheckTestTarget extends Command
{
    protected $signature = 'tarjetas:test-target:check';

    protected $description = 'Read-only verification of an explicitly approved disposable target';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $this->info('Approved disposable PostgreSQL target verified.');

        return self::SUCCESS;
    }
}
