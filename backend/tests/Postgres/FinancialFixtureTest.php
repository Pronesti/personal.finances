<?php

namespace Tests\Postgres;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\Attribution;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerReader;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Ledger\NativeMeasures;
use App\Domain\Reports\ReportSnapshot;
use App\Models\Ledger;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class FinancialFixtureTest extends PostgresTestCase
{
    private function balance(LedgerRepository $repository): array
    {
        $row = DB::selectOne("SELECT COALESCE(sum(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS expense, COALESCE(sum(CASE WHEN a.id='synthetic-visa-a:ARS:billed' THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS billed, COALESCE(sum(CASE WHEN a.id='synthetic-visa-a:ARS:unbilled' THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS unbilled, COALESCE(sum(CASE WHEN a.id='clearing:ARS:unresolved-source' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS clearing FROM accounting.journal_lines l JOIN accounting.journals j ON j.ledger_id=l.ledger_id AND j.id=l.journal_id JOIN accounting.accounts a ON a.ledger_id=l.ledger_id AND a.id=l.account_id WHERE l.ledger_id=? AND j.status='posted' AND j.currency='ARS'", [$repository->ledger->id]);

        return ['expenseMinor' => (int) $row->expense, 'billedMinor' => (int) $row->billed, 'unbilledMinor' => (int) $row->unbilled, 'clearingMinor' => (int) $row->clearing];
    }

    public function test_frozen_purchase_billing_repayment_credit_and_correction_persist_independently_per_owner(): void
    {
        $fixture = json_decode(file_get_contents(dirname(__DIR__, 3).'/docs/rebuild/fixtures/outcomes.json'), true)['ledger'];
        $cards = json_decode(file_get_contents(dirname(__DIR__, 3).'/docs/rebuild/fixtures/cards.json'), true);
        DB::beginTransaction();
        try {
            $owners = [];
            foreach (['A', 'B'] as $owner) {
                $ledger = Ledger::factory()->create();
                $repository = new LedgerRepository($ledger);
                $owners[] = $repository;
                app(CatalogBootstrap::class)->initialize($repository, $cards);
                $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:e1', 'kind' => 'synthetic', 'metadata' => '{}']));
                $commands = new FinancialCommands($repository);
                $base = ['cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'evidenceIds' => ['synthetic:e1']];
                $purchase = [...$base, 'key' => 'purchase', 'purchaseId' => 'purchase:shared', 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-15T12:00:00Z', 'principalMinor' => $fixture['purchaseMinor'], 'allocations' => $fixture['initialAllocations']];
                $this->assertSame('posted', $commands->purchase($purchase)['status']);
                $this->assertSame($fixture['afterPurchase'], $this->balance($repository));
                $this->assertSame('posted', $commands->bill([...$base, 'key' => 'billing', 'purchaseId' => $purchase['purchaseId'], 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'installment' => 1, 'amountMinor' => $fixture['billingMinor']])['status']);
                $this->assertSame($fixture['afterBilling'], $this->balance($repository));
                $this->assertSame([7001, 2000, 1000], $repository->payloads('billings')[0]['components'] === [] ? [] : array_column($repository->payloads('billings')[0]['components'], 'minor'));
                $this->assertSame('posted', $commands->repay([...$base, 'key' => 'payment', 'effectiveDate' => '2026-02-10', 'recordedAt' => '2026-02-10T12:00:00Z', 'amountMinor' => $fixture['paymentMinor'], 'issuerAllocations' => null])['status']);
                $this->assertSame($fixture['afterPayment'], $this->balance($repository));
                $this->assertSame('posted', $commands->credit([...$base, ...$fixture['credit'], 'key' => 'credit', 'purchaseId' => $purchase['purchaseId'], 'effectiveDate' => '2026-04-01', 'recordedAt' => '2026-04-01T12:00:00Z'])['status']);
                $this->assertSame($fixture['afterCredit'], $this->balance($repository));
                $correction = ['key' => 'correction', 'cardId' => $base['cardId'], 'purchaseId' => $purchase['purchaseId'], 'expectedVersion' => 1, 'replacement' => [...$purchase, 'allocations' => $fixture['replacementAllocations']], 'reason' => 'Synthetic classification correction', 'recordedAt' => $fixture['correctionRecordedAt']];
                $this->assertSame('posted', $commands->correct($correction)['status']);
                $fresh = new LedgerRepository($ledger->fresh());
                $this->assertSame($fixture['afterCorrection'], $this->balance($fresh));
                $report = (new ReportSnapshot($fresh))->read();
                $expenseFacts = array_filter($report['facts'], fn ($fact) => in_array($fact['kind'], ['purchase', 'credit', 'cost'], true));
                $this->assertSame($fixture['afterCorrection']['expenseMinor'], array_sum(array_column($expenseFacts, 'minor')));
                $this->assertCount(1, array_unique(array_column(array_filter($report['facts'], fn ($fact) => $fact['kind'] === 'credit'), 'journalId')));

                $this->assertSame(2, $fresh->purchase($purchase['purchaseId'])['version']);
                $this->assertSame(8, $fresh->query('journals')->count());
                $expense = [];
                foreach ($fresh->query('journals')->pluck('id') as $id) {
                    $journal = $fresh->journal($id);
                    foreach ($journal['lines'] as $line) {
                        if ($line['purposeId'] !== null) {
                            $expense[$line['purposeId']] = ($expense[$line['purposeId']] ?? 0) + $line['debitMinor'] - $line['creditMinor'];
                        }
                    }
                    if (in_array($journal['kind'], ['reversal', 'replacement'], true)) {
                        $this->assertContains($journal['effectiveDate'], [$fixture['correctionEffectiveDate'], $fixture['creditEffectiveDate']]);
                        $this->assertSame(strtotime($fixture['correctionRecordedAt']), strtotime($journal['recordedAt']));
                    }
                }
                $expense = array_filter($expense, fn ($minor) => $minor !== 0);
                $this->assertEquals($fixture['currentExpenseByPurpose'], $expense);
                $state = $fresh->state($base['cardId'], 'ARS');
                $inspection = (new LedgerReader($fresh))->inspection();
                $measures = array_values(array_filter($inspection['purposeMeasures'], fn ($row) => $row['cardId'] === $base['cardId'] && $row['currency'] === 'ARS'))[0]['rows'];
                $this->assertSame(48000, array_sum(array_column($measures, 'expenseMinor')));
                $this->assertSame(43000, array_sum(array_column($measures, 'debtMinor')));
                $this->assertSame(5000, array_sum(array_column($measures, 'repaymentMinor')));
                $purposeMap = array_column($measures, null, 'purposeId');
                $this->assertSame('19000', $purposeMap['food']['debtMinor']);
                $this->assertSame('24000', $purposeMap['travel']['debtMinor']);
                $group = ['id' => 'overlap', 'accountIds' => ['expense:food', 'expense:food:groceries:pantry', 'liability'], 'additive' => false];
                $journals = $fresh->query('journals')->where('status', 'posted')->pluck('id')->map(fn ($id) => $fresh->journal($id))->all();
                $mixed = (new NativeMeasures)->groups([$group], $inspection['accounts'], $journals, 'ARS', '2026-01-01', '2026-12-31')[0];
                $this->assertSame('24000', $mixed['expenseMinor']);
                $this->assertSame('43000', $mixed['debtMinor']);
                $this->assertSame('5000', $mixed['repaymentMinor']);

                $outstanding = Attribution::outstanding($state['billings'], $state['attributions'], $state['credits'], $state['componentRevisions'], $state['attributionRevisions'], $state['payments']);
                $this->assertEquals($fixture['outstandingByPurpose'], array_column($outstanding, 'outstandingMinor', 'purposeId'));
                $this->assertSame('duplicate', $commands->correct($correction)['status']);
                $this->assertSame(8, $fresh->query('journals')->count());
                try {
                    $commands->correct([...$correction, 'key' => 'competing']);
                    $this->fail('Stale correction accepted');
                } catch (AccountingError $error) {
                    $this->assertSame('stale_purchase_version', $error->errorCode);
                }
                $changed = [...$correction, 'key' => 'changed-principal', 'expectedVersion' => 2, 'replacement' => [...$correction['replacement'], 'principalMinor' => 60001]];
                $this->assertSame('correction_requires_schedule_revalidation', $commands->correct($changed)['reviewCode']);
                $this->assertSame(8, $fresh->query('journals')->count());
                $this->assertSame('duplicate', $commands->purchase([...$purchase, 'recordedAt' => '2026-06-01T12:00:00Z'])['status']);
                try {
                    $commands->purchase([...$purchase, 'principalMinor' => 60001, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 60001]]]);
                    $this->fail('Conflicting key accepted');
                } catch (AccountingError $error) {
                    $this->assertSame('command_conflict', $error->errorCode);
                }
            }
            $this->assertSame(8, $owners[0]->query('journals')->count());
            $this->assertNotSame($owners[0]->query('journals')->first()->row_id, $owners[1]->query('journals')->first()->row_id);
        } finally {
            DB::rollBack();
        }
    }
}
