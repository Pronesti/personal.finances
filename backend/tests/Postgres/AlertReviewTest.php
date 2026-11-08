<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReferenceTables;
use App\Models\Ledger;
use Tests\PostgresTestCase;

class AlertReviewTest extends PostgresTestCase
{
    public function test_shared_alert_identity_is_owner_scoped_with_replay_stale_refusal_and_no_money_changes(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $reference = $this->createMock(ReferenceTables::class);
        $reference->method('read')->willReturn(json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true));
        $this->app->instance(ReferenceTables::class, $reference);
        $owners = [];
        foreach (['a', 'b'] as $owner) {
            $ledger = Ledger::factory()->create();
            $repository = new LedgerRepository($ledger);
            $owners[] = [$ledger, $repository];
            app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            $raw = file_get_contents(base_path('../docs/rebuild/fixtures/mercadopago.expected.json'));
            $parsed = json_decode($raw, true);
            (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'alert-sources', 'cardId' => 'synthetic-mp', 'filename' => $parsed['file'], 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/'.$parsed['file'])), 'rawJson' => $raw, 'recordedAt' => '2026-02-01T12:00:00Z', 'appRevision' => 'alert-acceptance']);
        }
        [$a,$aRepository] = $owners[0];
        [$b,$bRepository] = $owners[1];
        $this->actingAs($a->owner, 'web');
        $list = $this->getJson('/api/v1/reports/anomalies?value=nominal')->assertOk()->json('data.alerts');
        $key = array_values(array_filter($list, fn ($row) => $row['source'] === 'integrity'))[0]['key'];
        $before = $aRepository->query('journals')->count();
        $path = '/api/v1/alerts/'.rawurlencode($key).'/state';
        $body = ['state' => 'reviewed', 'expectedPreviousDecisionId' => null];
        $decision = $this->withHeader('Idempotency-Key', 'mark-reviewed')->postJson($path, $body)->assertOk()->assertJsonPath('state', 'reviewed')->json('decisionId');
        $this->withHeader('Accept-Language', 'es')->postJson($path, $body)->assertOk()->assertJsonPath('duplicate', true)->assertJsonPath('decisionId', $decision);
        $this->withHeader('Idempotency-Key', 'stale')->postJson($path, ['state' => 'open', 'expectedPreviousDecisionId' => null])->assertConflict()->assertJsonPath('error.code', 'stale_review_version');
        $this->withHeader('Idempotency-Key', 'reopen')->postJson($path, ['state' => 'open', 'expectedPreviousDecisionId' => $decision])->assertOk()->assertJsonPath('state', 'open');
        $this->assertSame($before, $aRepository->query('journals')->count());
        app('auth')->forgetGuards();
        $this->actingAs($b->owner, 'web');
        $list = $this->getJson('/api/v1/reports/anomalies?value=nominal')->assertOk()->json('data.alerts');
        $own = array_values(array_filter($list, fn ($row) => $row['key'] === $key))[0];
        $this->assertSame('open', $own['state']);
        $this->assertSame(0, $bRepository->query('review_decisions')->where('kind', 'alert_state')->count());
        $this->withHeader('Idempotency-Key', 'unknown-alert')->postJson('/api/v1/alerts/computed:exclusively-unknown/state', $body)->assertNotFound();
        $this->assertSame(0,$bRepository->query('review_decisions')->where('kind','alert_state')->count());
    }
}
