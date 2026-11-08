<?php

namespace Tests\Postgres;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class JournalGuardsTest extends PostgresTestCase
{
    public function test_raw_postgresql_posting_and_immutability_guards_are_owner_qualified(): void
    {
        DB::beginTransaction();
        try {
            $repository = new LedgerRepository(Ledger::factory()->create());
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'synthetic-visa-a', 'displayName' => 'Synthetic Visa A']]);
            $repository->insert('evidence', ['id' => 'synthetic:e1', 'kind' => 'synthetic', 'metadata' => '{}']);
            foreach (['unbalanced_journal', 'missing_evidence', 'invalid_posting_account', 'posted'] as $case) {
                DB::statement('SAVEPOINT raw_post');
                $id = Str::uuid()->toString();
                try {
                    $repository->insert('journals', ['id' => $id, 'command_key' => $id, 'card_id' => 'synthetic-visa-a', 'currency' => 'ARS', 'effective_date' => '2026-01-15', 'recorded_at' => '2026-01-15T12:00:00Z', 'kind' => 'purchase']);
                    $repository->insert('journal_lines', ['journal_id' => $id, 'ordinal' => 0, 'account_id' => $case === 'invalid_posting_account' ? 'expense' : 'expense:unallocated', 'debit_minor' => 100, 'credit_minor' => 0], false);
                    $repository->insert('journal_lines', ['journal_id' => $id, 'ordinal' => 1, 'account_id' => 'synthetic-visa-a:ARS:unbilled', 'debit_minor' => 0, 'credit_minor' => $case === 'unbalanced_journal' ? 99 : 100], false);
                    if ($case !== 'missing_evidence') {
                        $repository->insert('journal_evidence', ['journal_id' => $id, 'evidence_id' => 'synthetic:e1'], false);
                    }
                    $repository->query('journals')->where('id', $id)->update(['status' => 'posted']);
                    $this->assertSame('posted', $case);
                    foreach (['journals', 'journal_lines', 'journal_evidence'] as $table) {
                        DB::statement('SAVEPOINT immutable_post');
                        try {
                            $repository->query($table)->where($table === 'journals' ? 'id' : 'journal_id', $id)->delete();
                            $this->fail('Posted record deletion succeeded');
                        } catch (QueryException $error) {
                            $this->assertStringContainsString('immutable_posted_journal', $error->getMessage());
                        } finally {
                            DB::statement('ROLLBACK TO SAVEPOINT immutable_post');
                        }
                    }
                } catch (QueryException $error) {
                    $this->assertNotSame('posted', $case);
                    $this->assertStringContainsString($case, $error->getMessage());
                } finally {
                    DB::statement('ROLLBACK TO SAVEPOINT raw_post');
                }
                $this->assertSame(0, $repository->query('journals')->count());
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_supported_opening_installments_never_create_expense(): void
    {
        DB::beginTransaction();
        try {
            $repository = new LedgerRepository(Ledger::factory()->create());
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'synthetic-visa-a', 'displayName' => 'Synthetic Visa A']]);
            $repository->insert('evidence', ['id' => 'synthetic:e1', 'kind' => 'synthetic', 'metadata' => '{}']);
            $commands = new FinancialCommands($repository);
            $id = Str::uuid()->toString();
            $base = ['cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'evidenceIds' => ['synthetic:e1']];
            $journal = [...$base, 'id' => $id, 'commandKey' => 'opening', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'lines' => [
                ['accountId' => 'equity:opening', 'debitMinor' => 12000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null],
                ['accountId' => 'synthetic-visa-a:ARS:unbilled', 'debitMinor' => 0, 'creditMinor' => 12000, 'purchaseId' => null, 'purposeId' => null],
            ]];
            $commands->post($journal);
            $obligation = [...$base, 'id' => 'opening:plan', 'openingJournalId' => $id, 'originalPrincipalMinor' => 12000, 'alreadyBilledMinor' => 0, 'remainingMinor' => 12000, 'purchaseDate' => '2026-01-15', 'lastBilledInstallment' => 0, 'installmentCount' => 2, 'allocations' => [['purposeId' => 'food', 'minor' => 12000]]];
            $commands->registerOpening($obligation);
            $commands->registerOpening($obligation);
            $input = [...$base, 'key' => 'opening-billing', 'openingObligationId' => $obligation['id'], 'installment' => 1, 'amountMinor' => 6000, 'effectiveDate' => '2026-03-01', 'recordedAt' => '2026-03-01T12:00:00Z'];
            $this->assertSame('posted', $commands->billOpening($input)['status']);
            $this->assertSame('duplicate', $commands->billOpening($input)['status']);
            $this->assertSame('billing_exceeds_opening_remaining', $commands->billOpening([...$input, 'key' => 'excess', 'installment' => 2, 'amountMinor' => 7000])['reviewCode']);
            $this->assertSame(2, $repository->query('journals')->count());
            $this->assertSame(0, $repository->query('purchases')->count());
            $row = DB::selectOne("SELECT sum(CASE WHEN account_id='synthetic-visa-a:ARS:billed' THEN credit_minor-debit_minor ELSE 0 END) AS billed, sum(CASE WHEN account_id='synthetic-visa-a:ARS:unbilled' THEN credit_minor-debit_minor ELSE 0 END) AS unbilled, sum(CASE WHEN account_id LIKE 'expense:%' THEN debit_minor-credit_minor ELSE 0 END) AS expense FROM accounting.journal_lines WHERE ledger_id=?", [$repository->ledger->id]);
            $this->assertSame([6000, 6000, 0], [(int) $row->billed, (int) $row->unbilled, (int) $row->expense]);
        } finally {
            DB::rollBack();
        }
    }
}
