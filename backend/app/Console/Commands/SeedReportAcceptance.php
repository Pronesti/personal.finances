<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Evidence\SourceIdentity;
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

/** Real PostgreSQL/domain state for browser charts, derived from frozen synthetic inputs.
 * This deliberately is not the exact portable read-model adapter: it obeys native posting
 * constraints and derives identifiers, source occurrences, corrections and credit allocations.
 * Extraction seams here are explicit; actual PDF parser acceptance is a separate journey.
 */
class SeedReportAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:report-users';

    protected $description = 'Create fresh guarded factory ledgers with six months of native report/chart evidence';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $fixture = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/report-input.json')), true);
        $emails = [];
        foreach (['a', 'b'] as $owner) {
            $email = 'synthetic-reports-'.$owner.'-'.Str::uuid().'@example.invalid';
            $user = User::factory()->create(['email' => $email, 'name' => 'Synthetic report owner '.$owner, 'password' => 'Synthetic-Acceptance-Only-2026!']);
            $ledger = Ledger::factory()->create(['owner_user_id' => $user->id]);
            $repository = new LedgerRepository($ledger);
            app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            $commands = new FinancialCommands($repository);
            $importer = new StatementImporter($repository, app(DocumentStore::class));
            $purchaseIds = [];
            $planLines = [];
            $creditLines = [];
            $revisions = [];
            foreach ($fixture['statements'] as $statement) {
                $period = ['closing_date' => $statement['closingDate'], 'previous_closing_date' => $statement['previousClosingDate'], 'due_date' => $statement['dueDate']];
                $raw = ['file' => 'synthetic_report_'.str_replace('-', '_', $statement['cycleMonth']).'.pdf', 'brand' => 'visa', 'period' => $period, 'balances' => ['current_ars' => $statement['balanceArsMinor'] / 100, 'current_usd' => $statement['balanceUsdMinor'] === null ? null : $statement['balanceUsdMinor'] / 100, 'previous_ars' => ($statement['previousBalanceArsMinor'] ?? 0) / 100, 'minimum_payment_ars' => ($statement['minimumPaymentArsMinor'] ?? 0) / 100], 'limits' => ['purchase' => ($statement['purchaseLimitArsMinor'] ?? 0) / 100], 'rates' => ['annual_nominal_ars' => $statement['tnaPct'], 'monthly_effective_ars' => $statement['temPct']], 'transactions' => [], 'declared_totals' => [], 'upcoming_installments' => [], 'synthetic_extraction_seam' => true];
                $facts = array_values(array_filter($fixture['facts'], fn ($fact) => $fact['statementId'] === $statement['id'] && ($fact['kind'] === 'billing' || $fact['kind'] === 'cost' || $fact['kind'] === 'credit')));
                foreach ($facts as $index => $fact) {
                    $raw['transactions'][] = ['section' => $fact['kind'] === 'cost' ? 'taxes_and_charges' : ($fact['sourceSection'] ?? 'purchases'), 'date' => $fact['kind'] === 'billing' ? ($fact['purchaseDate'] ?? $fact['effectiveDate']) : $fact['effectiveDate'], 'description' => $fact['description'] ?? $fact['merchant'], 'voucher' => 'SYNTHETIC-'.($index + 1), 'ars' => $fact['currency'] === 'ARS' ? $fact['minor'] / 100 : null, 'usd' => $fact['currency'] === 'USD' ? $fact['minor'] / 100 : null, 'installment_number' => $fact['installmentNumber'] ?? null, 'installment_count' => $fact['installmentCount'] ?? null, 'raw_line' => 'EXPLICIT SYNTHETIC REPORT EXTRACTION SEAM'];
                }
                foreach ($fixture['schedules'] as $schedule) {
                    if ($schedule['revisionId'] === $statement['sourceRevisionId']) {
                        $raw['upcoming_installments'][] = ['month' => $schedule['month'], 'amount_ars' => $schedule['amount']];
                    }
                }
                if ($statement['cardId'] === 'synthetic-visa-a' && $statement['cycleMonth'] === '2026-05') {
                    $raw['upcoming_installments'][] = ['month' => '2026-07', 'amount_ars' => 999];
                }
                $input = ['key' => 'synthetic:report:'.$statement['id'], 'cardId' => $statement['cardId'], 'filename' => $raw['file'], 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf'))."\n% synthetic report ".$statement['id'], 'rawJson' => json_encode($raw), 'recordedAt' => $statement['closingDate'].'T12:00:00Z', 'appRevision' => config('tarjetas.revision')];
                $result = $importer->import($input);
                $revisions[$statement['id']] = $result['sourceRevisionId'];
                foreach ($facts as $index => $fact) {
                    $line = SourceIdentity::line($result['sourceRevisionId'], $index + 1);
                    if ($fact['purchaseId'] === 'plan') {
                        $planLines[] = ['fact' => $fact, 'line' => $line];

                        continue;
                    }if ($fact['kind'] === 'credit' && $fact['origin'] === 'ledger') {
                        $creditLines[$fact['id']] = $line;
                    }if ($fact['kind'] !== 'billing') {
                        continue;
                    }$identity = $repository->query('source_purchase_identities')->where('source_line_id', $line)->where('currency', $fact['currency'])->first();
                    if ($identity === null) {
                        throw new \RuntimeException('synthetic_report_purchase_missing');
                    }$purchaseIds[$fact['purchaseId']] = $identity->purchase_id;
                    $purchase = $repository->purchase($identity->purchase_id);
                    $commands->correct(['key' => 'synthetic:report:classification:'.$fact['purchaseId'], 'cardId' => $statement['cardId'], 'purchaseId' => $purchase['purchaseId'], 'expectedVersion' => $purchase['version'], 'replacement' => [...$purchase, 'allocations' => [['accountId' => $fact['accountId'], 'purposeId' => $fact['purposeId'], 'minor' => $purchase['principalMinor']]]], 'reason' => 'Explicit synthetic fixture account classification', 'recordedAt' => '2026-08-01T12:00:00Z']);
                }
            }
            $plan = array_values(array_filter($fixture['facts'], fn ($fact) => $fact['kind'] === 'purchase' && $fact['purchaseId'] === 'plan'))[0];
            $proof = $planLines[0]['line'];
            $commands->purchase(['key' => 'synthetic:report:supported-plan', 'purchaseId' => 'synthetic:supported-plan', 'cardId' => $plan['cardId'], 'currency' => $plan['currency'], 'effectiveDate' => $plan['effectiveDate'], 'recordedAt' => '2026-08-01T12:00:00Z', 'evidenceIds' => [$proof], 'principalMinor' => $plan['minor'], 'allocations' => [['accountId' => $plan['accountId'], 'purposeId' => $plan['purposeId'], 'minor' => $plan['minor']]]]);
            foreach ($planLines as $row) {
                $fact = $row['fact'];
                $commands->bill(['key' => 'synthetic:report:plan-bill:'.$fact['installmentNumber'], 'purchaseId' => 'synthetic:supported-plan', 'cardId' => $fact['cardId'], 'currency' => $fact['currency'], 'effectiveDate' => $fact['effectiveDate'], 'recordedAt' => '2026-08-01T12:00:00Z', 'evidenceIds' => [$row['line']], 'installment' => $fact['installmentNumber'], 'amountMinor' => $fact['minor']]);
            }
            $credit = array_values(array_filter($fixture['facts'], fn ($fact) => $fact['kind'] === 'credit' && $fact['origin'] === 'ledger'))[0];
            $purchase = $repository->purchase($purchaseIds[$credit['purchaseId']]);
            $commands->credit(['key' => 'synthetic:report:linked-credit', 'purchaseId' => $purchase['purchaseId'], 'cardId' => $purchase['cardId'], 'currency' => $purchase['currency'], 'amountMinor' => -$credit['minor'], 'billedReductionMinor' => -$credit['minor'], 'unbilledReductionMinor' => 0, 'effectiveDate' => $credit['effectiveDate'], 'recordedAt' => '2026-08-01T12:00:00Z', 'evidenceIds' => [$creditLines[$credit['id']]]]);
            $service = new ReceiptService($repository, app(DocumentStore::class));
            $products = new ReceiptProducts($repository);
            foreach ([0, 1] as $trip) {
                $rows = file_get_contents(base_path('../docs/rebuild/fixtures/receipt-valid.rows.txt'));
                if ($trip === 1) {
                    $rows = str_replace(['15/01/2026', '9999-00000001', "\t100,00", "\t50,00", "\t150,00", "\t130,00"], ['15/02/2026', '9999-00000002', "\t120,00", "\t60,00", "\t180,00", "\t155,00"], $rows);
                    $rows = str_replace('SYNTHETIC SOAP'."\n".'0000000002 00000000000000'."\t60,00", 'SYNTHETIC SOAP'."\n".'0000000002 00000000000000'."\t60,00\n".'1 *SYNTHETIC COTO OFFER [A]'."\t-5,00", $rows);
                    $rows = str_replace("DESCUENTOS POR PROMOCIONES\t-20,00", "DESCUENTOS POR PROMOCIONES\t-25,00", $rows);
                    $rows = str_replace("AHORRO\t20,00", "AHORRO\t25,00", $rows);
                }
                $receipt = $service->import(['key' => 'synthetic:report:receipt:'.$trip, 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')).($trip === 1 ? "\n% synthetic second receipt" : ''), 'rowsText' => $rows, 'scale' => 3, 'recordedAt' => $trip === 0 ? '2026-01-16T12:00:00Z' : '2026-02-16T12:00:00Z', 'appRevision' => config('tarjetas.revision')], new ProcessingBudget(719000, 0));
                foreach ([1, 2] as $occurrence) {
                    $line = SourceIdentity::line($receipt['sourceRevisionId'], $occurrence);
                    $match = $products->latest('product_match_revisions', 'id', $line);
                    $product = $products->product($match['productId']);
                    if (! $product['reviewed']) {
                        $products->decide(['key' => 'synthetic:report:product:'.$product['id'], 'kind' => 'product_update', 'subjectId' => $product['id'], 'payload' => ['name' => $occurrence === 1 ? 'Synthetic Rice' : 'Synthetic Soap', 'category' => $occurrence === 1 ? 'pantry' : 'personal_care', 'unit' => 'un'], 'recordedAt' => '2026-08-01T12:00:00Z']);
                    }$products->decide(['key' => 'synthetic:report:item:'.$line, 'kind' => 'product_match', 'subjectId' => $line, 'payload' => ['productId' => $product['id']], 'recordedAt' => '2026-08-01T12:00:00Z']);
                }
            }
            $emails[$owner] = $email;
        }
        $this->line(json_encode($emails));

        return self::SUCCESS;
    }
}
