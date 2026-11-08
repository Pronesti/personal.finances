<?php

namespace App\Console\Commands;

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\User;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class SeedRecoveryAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:recovery-users {output : New absolute private JSON state file; contains synthetic session cookies}';

    protected $description = 'Seed guarded source sentinels and a valid pre-capture synthetic database session for recovery acceptance';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $output = $this->argument('output');
        PrivateRoots::canonical(dirname($output));
        if (file_exists($output) || is_link($output)) {
            throw new \RuntimeException('acceptance_output_exists');
        }
        Artisan::call('tarjetas:acceptance:document-users');
        $emails = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
        $state = [];
        foreach (['a' => 10500, 'b' => 20300] as $owner => $minor) {
            $user = User::query()->where('email', $emails[$owner])->firstOrFail();
            $repository = new LedgerRepository($user->ledger);
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:recovery-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            (new FinancialCommands($repository))->purchase(['key' => 'synthetic:recovery-purchase', 'purchaseId' => 'purchase:shared', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-15T12:00:00Z', 'evidenceIds' => ['synthetic:recovery-proof'], 'principalMinor' => $minor, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => $minor]]]);
            $state[$owner] = ['email' => $user->email, 'ledgerId' => $repository->ledger->id, 'minor' => $minor];
        }
        $user = User::query()->where('email', $emails['a'])->firstOrFail();
        $session = app('session')->driver();
        $session->start();
        Auth::guard('web')->login($user);
        $session->save();
        $id = $session->getId();
        $row = DB::table('sessions')->where('id', $id)->first();
        if ($row === null || (int) $row->user_id !== $user->id) {
            throw new \RuntimeException('synthetic_source_session_not_persisted');
        }
        $transportName = 'tarjetas_recovery_session';
        $encrypted = app('encrypter')->encrypt(CookieValuePrefix::create($transportName, app('encrypter')->getKey()).$id, false);
        $state['oldSession'] = ['name' => $transportName, 'value' => $encrypted, 'domain' => '.tarjetas-recovery.test', 'path' => '/', 'httpOnly' => true, 'secure' => true, 'sameSite' => 'Lax'];
        $state['sourceSessionId'] = $id;
        $state['sourceCookieName'] = config('session.cookie');
        $state['note'] = 'Same source APP_KEY and genuine pre-capture authenticated session ID; cookie-name transport adapted to force restored session-store validation.';
        $file = fopen($output, 'xb');
        chmod($output, 0600);
        fwrite($file, json_encode($state, JSON_THROW_ON_ERROR));
        fflush($file);
        fsync($file);
        fclose($file);
        $this->info('Synthetic recovery owners, native sentinels and protected pre-capture session state prepared.');

        return self::SUCCESS;
    }
}
