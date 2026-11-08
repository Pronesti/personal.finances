<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Models\Ledger;
use App\Models\User;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/** Fixed synthetic factories and explicit extraction seams; never production provisioning. */
class SeedHistoricalAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:historical-refund {--fresh : Create a fresh factory pair and emit their synthetic emails as JSON}';

    protected $description = 'Seed two guarded synthetic opening/source/receipt cases for browser historical acceptance';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $emails = [];
        foreach (['a', 'b'] as $owner) {
            $email = 'synthetic-history-'.$owner.($this->option('fresh') ? '-'.Str::uuid() : '').'@example.invalid';
            $emails[$owner] = $email;
            $user = User::where('email', $email)->first() ?? User::factory()->create(['name' => 'Synthetic historical '.$owner, 'email' => $email, 'password' => 'Synthetic-Acceptance-Only-2026!']);
            $ledger = $user->ledger ?? Ledger::factory()->create(['owner_user_id' => $user->id]);
            $repository = new LedgerRepository($ledger);
            app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            $repository->transaction(function () use ($repository) {
                if (! $repository->query('evidence')->where('id', 'synthetic:opening-proof')->exists()) {
                    $repository->insert('evidence', ['id' => 'synthetic:opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']);
                }
            });
            (new FinancialCommands($repository))->post(['id' => Str::uuid()->toString(), 'commandKey' => 'synthetic:opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['synthetic:opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 13000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 13000, 'purchaseId' => null, 'purposeId' => null]]]);
            $sources = new ReceiptService($repository, app(DocumentStore::class));
            $sources->import(['key' => 'synthetic:historical-receipt', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-valid.rows.txt')), 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => config('tarjetas.revision')], new ProcessingBudget(719000, 0));
            foreach ([false, true] as $refund) {
                $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
                $raw->declared_totals = [];
                if ($refund) {
                    $raw->period->closing_date = '2026-03-31';
                }
                $raw->transactions = [(object) ['section' => 'purchases', 'date' => $refund ? '2026-03-05' : '2026-01-15', 'description' => $refund ? 'DEVOLUCION COTO SYNTHETIC' : 'COTO SYNTHETIC', 'ars' => $refund ? -130 : 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => $refund ? '05-mar-26 DEVOLUCION COTO -130,00' : '15-ene-26 COTO 130,00']];
                (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => $refund ? 'synthetic:refund-source' : 'synthetic:historical-source', 'cardId' => 'synthetic-visa-a', 'filename' => $refund ? 'synthetic_refund_2026_03.pdf' : 'synthetic_original_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')).($refund ? "\n% explicit synthetic refund extraction seam" : ''), 'rawJson' => json_encode($raw), 'recordedAt' => $refund ? '2026-03-31T12:00:00Z' : '2026-02-01T12:00:00Z', 'appRevision' => config('tarjetas.revision'), 'observationOnly' => ! $refund]);
            }
        }
        if ($this->option('fresh')) {
            $this->line(json_encode($emails, JSON_THROW_ON_ERROR));
        } else {
            $this->info('Two synthetic historical cases retained on the approved disposable target.');
        }

        return self::SUCCESS;
    }
}
