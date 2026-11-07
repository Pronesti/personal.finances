<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptRejected;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Models\User;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

/** Explicit deterministic extraction seam confined to guarded synthetic acceptance. */
class SeedReceiptAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:receipt-rejection';

    protected $description = 'Retain the frozen one-cent rejection for synthetic user B on an approved disposable target';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $user = User::where('email', 'synthetic-b@example.invalid')->firstOrFail();
        abort_unless($user->ledger?->id === '22222222-2222-4222-8222-222222222222', 400);
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $service = new ReceiptService(new LedgerRepository($user->ledger), app(DocumentStore::class));
        try {
            $result = $service->import(['key' => 'frozen-one-cent-rejection', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-one-cent-error.rows.txt')), 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => config('tarjetas.revision')], new ProcessingBudget(719000, 0));
            $this->line(json_encode(['receiptId' => $result['receiptId'], 'duplicate' => $result['duplicate']]));
        } catch (ReceiptRejected $error) {
            $this->line(json_encode(['receiptId' => $error->receiptPayload['receiptId'], 'retained' => true, 'code' => $error->errorCode]));
        }

        return self::SUCCESS;
    }
}
