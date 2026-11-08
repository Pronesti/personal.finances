<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ExpireAcceptanceSession extends Command
{
    protected $signature = 'tarjetas:acceptance:expire-session {email : Explicit synthetic factory email}';

    protected $description = 'Expire only one guarded synthetic factory user database session set';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $email = $this->argument('email');
        if (! preg_match('/^synthetic-[A-Za-z0-9.-]+@example\\.invalid$/D', $email)) {
            throw new \RuntimeException('synthetic_factory_identity_required');
        }$user = User::query()->where('email', $email)->firstOrFail();
        $count = DB::table('sessions')->where('user_id', $user->id)->delete();
        $this->line(json_encode(['expired' => $count], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
