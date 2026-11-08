<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reviews\MerchantProposalProvider;
use App\Domain\Reviews\MerchantProposals;
use App\Domain\Reviews\SourceClassification;
use App\Domain\Reviews\SyntheticProposals;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class MerchantProposalsTest extends PostgresTestCase
{
    private function statement(LedgerRepository $repository, string $name, string $date, string $key): array
    {
        $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
        $raw->period->closing_date = (new \DateTimeImmutable($date))->modify('last day of next month')->format('Y-m-d');
        $raw->transactions = [(object) ['section' => 'purchases', 'block' => 1, 'date' => $date, 'description' => $name, 'voucher' => $key, 'ars' => 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => $name.' 130,00']];
        $raw->declared_totals = [];

        return (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => $key, 'cardId' => 'merchant-card', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf'))."\n%synthetic-".$key, 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'merchant-test']);
    }

    public function test_optional_proposals_require_human_selection_preserve_wire_text_and_suppress_rejections(): void
    {
        $owner = Ledger::factory()->create();
        $r = new LedgerRepository($owner);
        app(CatalogBootstrap::class)->initialize($r, [['id' => 'merchant-card', 'displayName' => 'Synthetic']]);
        $first = $this->statement($r, 'SYNTHETIC PANTRY 123456789', '2026-01-15', 'proposal-one');
        $this->statement($r, 'SYNTHETIC SECOND', '2026-02-16', 'proposal-two');
        $this->actingAs($owner->owner, 'web');
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'disabled'])->assertStatus(503)->assertJsonPath('error.code', 'proposals_unavailable');
        $this->app->bind(MerchantProposalProvider::class, SyntheticProposals::class);
        $journals = $r->query('journals')->count();
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'generate'])->assertOk()->assertJsonCount(2, 'created');
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'generate'])->assertOk()->assertJsonPath('duplicate', true);
        $proposals = $this->getJson('/api/v1/merchant-proposals')->assertOk()->json('proposals');
        $this->assertSame($journals, $r->query('journals')->count());
        $proposal = array_values(array_filter($proposals, fn ($p) => $p['wireName'] === 'SYNTHETIC PANTRY'))[0];
        $body = ['action' => 'accept', 'expectedSeq' => $proposal['seq'], 'purchaseId' => $first['purchaseIds'][0], 'cardId' => 'merchant-card', 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedVersion' => 1];
        $this->postJson('/api/v1/merchant-proposals/'.$proposal['id'].'/decision', $body, ['Idempotency-Key' => 'accept'])->assertOk()->assertJsonPath('state', 'accepted');
        $this->assertSame('home', $r->purchase($first['purchaseIds'][0])['allocations'][0]['purposeId']);
        $this->assertSame(13000, $r->purchase($first['purchaseIds'][0])['principalMinor']);
        $other = array_values(array_filter($proposals, fn ($p) => $p['id'] !== $proposal['id']))[0];
        $this->postJson('/api/v1/merchant-proposals/'.$other['id'].'/decision', ['action' => 'reject', 'expectedSeq' => $other['seq']], ['Idempotency-Key' => 'reject'])->assertOk()->assertJsonPath('state', 'rejected');
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'regenerate'])->assertOk()->assertJsonPath('created', []);
        $foreign = Ledger::factory()->create();
        app('auth')->forgetGuards();
        $this->actingAs($foreign->owner, 'web')->getJson('/api/v1/merchant-proposals')->assertOk()->assertJsonPath('proposals', []);
        $this->postJson('/api/v1/merchant-proposals/'.$proposal['id'].'/decision', $body, ['Idempotency-Key' => 'foreign'])->assertNotFound();
    }

    public function test_invalid_provider_output_and_failure_are_atomic_and_money_shaped_names_never_cross_boundary(): void
    {
        foreach (['STORE 123,45', 'STORE 12.345,67', 'STORE 10%', 'STORE TC12', 'STORE 1234567,89', 'STORE USD 500', 'SU PAGO EN PESOS', 'STORE 2026-01-15', 'STORE 15/01/2026', 'TC 1500'] as $name) {
            $this->assertNull(MerchantProposals::wireName($name));
        }
        $this->assertSame('STORE', MerchantProposals::wireName('STORE 123456789'));
        $this->assertSame('CARREFOUR 24', MerchantProposals::wireName('CARREFOUR 24'));
        $owner = Ledger::factory()->create();
        $r = new LedgerRepository($owner);
        app(CatalogBootstrap::class)->initialize($r, [['id' => 'merchant-card', 'displayName' => 'Synthetic']]);
        $this->statement($r, 'SYNTHETIC SAFE 123456789', '2026-01-15', 'safe');
        $this->statement($r, 'SYNTHETIC 123,45', '2026-02-16', 'money');
        $this->actingAs($owner->owner, 'web');
        $this->app->instance(MerchantProposalProvider::class, new class implements MerchantProposalProvider
        {
            public function suggest(array $names): array
            {
                if ($names !== ['SYNTHETIC SAFE']) {
                    throw new \LogicException('unsafe wire');
                }

                return [['name' => 'UNKNOWN', 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'confidence' => 1]];
            }
        });
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'invalid'])->assertStatus(400)->assertJsonPath('error.code', 'invalid_proposal_response');
        $this->assertSame(0, $r->query('proposal_revisions')->count());
        $this->app->instance(MerchantProposalProvider::class, new class implements MerchantProposalProvider
        {
            public function suggest(array $names): array
            {
                throw new \RuntimeException('private provider credentials');
            }
        });
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'failed'])->assertStatus(503)->assertJsonPath('error.code', 'proposal_service_failed');
        $this->getJson('/api/v1/accounting')->assertOk();
        $this->assertSame(0, $r->query('proposal_revisions')->count());
    }

    public function test_historical_source_proposals_classify_retained_acquisitions_without_posting_purchases(): void
    {
        $owner = Ledger::factory()->create();
        $r = new LedgerRepository($owner);
        app(CatalogBootstrap::class)->initialize($r, [['id' => 'merchant-card', 'displayName' => 'Synthetic']]);
        $r->transaction(fn () => $r->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
        (new FinancialCommands($r))->post(['id' => 'opening-journal', 'commandKey' => 'opening', 'cardId' => 'merchant-card', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T00:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 10000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'merchant-card:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 10000, 'purchaseId' => null, 'purposeId' => null]]]);
        (new StatementImporter($r, app(DocumentStore::class)))->import(['key' => 'historic', 'cardId' => 'merchant-card', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')), 'rawJson' => file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')), 'recordedAt' => '2026-02-02T00:00:00Z', 'appRevision' => 'synthetic-proposal', 'observationOnly' => true]);
        $this->actingAs($owner->owner, 'web');
        $this->app->bind(MerchantProposalProvider::class, SyntheticProposals::class);
        $this->postJson('/api/v1/merchant-proposals/generate', [], ['Idempotency-Key' => 'historical-proposal'])->assertOk()->assertJsonCount(2, 'created');
        $proposal = $this->getJson('/api/v1/merchant-proposals')->assertOk()->json('proposals.0');
        $this->assertSame('source', $proposal['subjectKind']);
        $this->postJson('/api/v1/merchant-proposals/'.$proposal['id'].'/decision', ['action' => 'accept', 'expectedSeq' => $proposal['seq'], 'sourceLineId' => $proposal['sourceLineId'], 'expectedPreviousDecisionId' => null, 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'scope' => 'selected', 'match' => null], ['Idempotency-Key' => 'human-source-accept'])->assertOk()->assertJsonPath('state', 'accepted');
        $this->assertSame(0, $r->query('purchases')->count());
        $this->assertSame(1, $r->query('journals')->count());
        $classified = array_values(array_filter((new SourceClassification($r))->eligible(), fn ($row) => $row['sourceLineId'] === $proposal['sourceLineId']))[0];
        $this->assertSame('food', $classified['purposeId']);
    }
}
