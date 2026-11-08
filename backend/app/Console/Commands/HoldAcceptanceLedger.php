<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class HoldAcceptanceLedger extends Command
{
    protected $signature = 'tarjetas:acceptance:hold-ledger {email : Synthetic factory email} {marker? : New private readiness marker} {--status : Read same-role advisory wait activity without locking}';

    protected $description = 'Bounded guarded synthetic ledger lock for real HTTP cancellation acceptance';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $email = $this->argument('email');
        if (! preg_match('/^synthetic-[A-Za-z0-9.-]+@example\\.invalid$/D', $email)) {
            throw new \RuntimeException('synthetic_factory_identity_required');
        }$ledger = User::query()->where('email', $email)->firstOrFail()->ledger;
        if ($ledger === null) {
            throw new \RuntimeException('synthetic_ledger_required');
        }
        if ($this->option('status')) {
            $row = DB::selectOne("SELECT count(*) AS waiting FROM pg_stat_activity WHERE usename=current_user AND pid<>pg_backend_pid() AND state='active' AND lower(wait_event)='advisory' AND query LIKE '%pg_advisory_xact_lock%'");
            $this->line(json_encode(['waiting' => (int) $row->waiting], JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        $path = $this->argument('marker');
        $root = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root'));
        if (! is_string($path) || ! str_starts_with($path, $root.'/') || ! preg_match('/^hold-[a-f0-9-]+\\.json$/D', basename($path)) || file_exists($path)) {
            throw new \RuntimeException('private_new_hold_marker_required');
        }PrivateRoots::canonical(dirname($path));
        DB::transaction(function () use ($ledger, $path) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?,8581401))', [$ledger->id]);
            $file = fopen($path, 'xb');
            chmod($path, 0600);
            fwrite($file, '{"locked":true}');
            fflush($file);
            fclose($file);
            usleep(6000000);
        });
        $this->line('{"released":true}');

        return self::SUCCESS;
    }
}
