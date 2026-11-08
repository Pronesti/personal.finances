<?php

namespace Tests\Postgres;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class AccountingReadTest extends PostgresTestCase
{
    public function test_http_reader_returns_distinct_native_sentinels_and_rejects_forged_owner(): void
    {
        $owners = [];
        foreach ([[10500, 1700], [20300, 2900]] as $index => $amounts) {
            $ledger = Ledger::factory()->create();
            $owners[] = $ledger;
            $repository = new LedgerRepository($ledger);
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'synthetic-visa-a', 'displayName' => 'Synthetic Visa A']]);
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:e1', 'kind' => 'synthetic', 'metadata' => '{}']));
            foreach ($amounts as $number => $amount) {
                (new FinancialCommands($repository))->purchase(['key' => 'synthetic:command:'.$number, 'purchaseId' => $number === 0 ? 'purchase:shared' : 'purchase:exclusive:'.$index, 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-15T12:00:00Z', 'evidenceIds' => ['synthetic:e1'], 'principalMinor' => $amount, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => $amount]]]);
            }
        }
        $journalIds = [];
        foreach ($owners as $index => $ledger) {
            app('auth')->forgetGuards();
            $response = $this->actingAs($ledger->owner, 'web')->getJson('/api/v1/accounting');
            $response->assertOk()->assertJsonPath('meta.total', 2);
            $journalIds[$index] = $response->json('journals.0.id');
            $this->getJson('/api/v1/accounting?journal='.$journalIds[$index])->assertOk()->assertJsonCount(1, 'journals')->assertJsonPath('journals.0.id', $journalIds[$index]);
            $accounts = $response->json('accounts');
            $pantry = array_values(array_filter($accounts, fn ($row) => $row['id'] === 'expense:food:groceries:pantry'))[0];
            $this->assertSame($index === 0 ? '12200' : '23200', $pantry['balances']['ARS']);
            $this->assertSame('0', $pantry['balances']['USD']);
        }
        app('auth')->forgetGuards();
        $this->actingAs($owners[0]->owner, 'web')->getJson('/api/v1/accounting?ledger_id='.$owners[1]->id)->assertStatus(400)->assertJsonPath('error.code', 'owner_scope_conflict');
        $this->getJson('/api/v1/accounting?journal='.$journalIds[1])->assertNotFound();
        $this->getJson('/api/v1/accounting?journal=not-a-uuid')->assertUnprocessable();
        $this->getJson('/api/v1/accounting/evidence/does-not-exist')->assertNotFound();
        $this->getJson('/api/v1/accounting?per_page=1000')->assertUnprocessable();
    }
}
