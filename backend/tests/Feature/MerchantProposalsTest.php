<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reviews\MerchantProposalProvider;
use App\Domain\Reviews\MerchantProposals;
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
        foreach (['STORE 123,45', 'STORE 12.345,67', 'STORE 10%', 'STORE TC12'] as $name) {
            $this->assertNull(MerchantProposals::wireName($name));
        }
        $this->assertSame('STORE', MerchantProposals::wireName('STORE 123456789'));
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
}
