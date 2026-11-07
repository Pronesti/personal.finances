<?php

namespace App\Providers;

use App\Domain\Reviews\DisabledProposals;
use App\Domain\Reviews\MerchantProposalProvider;
use App\Domain\Reviews\SyntheticProposals;
use App\Support\TestTargetGuard;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(MerchantProposalProvider::class, fn () => config('tarjetas.proposal_driver') === 'synthetic-test' ? new SyntheticProposals : new DisabledProposals);
    }

    public function boot(): void
    {
        Sanctum::getAccessTokenFromRequestUsing(fn () => null);
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)->by(hash('sha256', mb_strtolower((string) $request->input('email')).'|'.$request->ip())));
        Event::listen(CommandStarting::class, function (CommandStarting $event): void {
            $command = (string) $event->command;
            if (str_starts_with($command, 'migrate') || in_array($command, ['db:wipe', 'db:seed', 'test', 'serve'], true)) {
                if (in_array(config('app.env'), ['testing', 'browser-testing'], true)) {
                    $this->app->make(TestTargetGuard::class)->check();
                } elseif (in_array($command, ['migrate:fresh', 'migrate:refresh', 'migrate:reset', 'db:wipe', 'db:seed', 'test'], true)) {
                    throw new \RuntimeException('Destructive setup requires an approved disposable test environment.');
                }
            }
        });
    }
}
