<?php

namespace Tests\Postgres;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\HistoricalAssociations;
use App\Domain\Evidence\HistoricalRefund;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptReconciliation;
use App\Domain\Evidence\ReceiptRejected;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Evidence\SourceIdentity;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reports\ReportSnapshot;
use App\Domain\Reviews\SourceClassification;
use App\Models\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class ReceiptWorkflowsTest extends PostgresTestCase
{
    private function setupLedger(): array
    {
        config(['tarjetas.python' => base_path('.venv/bin/python'), 'tarjetas.revision' => 'receipt-acceptance']);
        $repository = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
        $service = new ReceiptService($repository, app(DocumentStore::class));

        return [$repository, $service, new ReceiptReconciliation($service)];
    }

    private function input(string $transcript = 'receipt-valid.rows.txt'): array
    {
        return ['key' => 'synthetic:shared-receipt', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/'.$transcript)), 'correctedRowsText' => null, 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'receipt-acceptance'];
    }

    private function statement(LedgerRepository $repository, bool $observationOnly = false): array
    {
        $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
        $raw->transactions = [(object) ['section' => 'purchases', 'block' => 1, 'block_cardholder' => 'SYNTHETIC HOLDER', 'date' => '2026-01-15', 'description' => 'COTO SYNTHETIC', 'voucher' => '123456', 'ars' => 130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => '15-ene-26 COTO SYNTHETIC 123456 130,00']];
        $raw->declared_totals = [];

        return (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'coto-statement', 'cardId' => 'synthetic-visa-a', 'filename' => 'synthetic_visa_2026_02.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf')), 'rawJson' => json_encode($raw), 'recordedAt' => '2026-02-02T12:00:00Z', 'appRevision' => 'receipt-acceptance', 'observationOnly' => $observationOnly]);
    }

    private function expense(LedgerRepository $repository): int
    {
        return (int) DB::selectOne("SELECT COALESCE(sum(l.debit_minor-l.credit_minor),0) AS amount FROM accounting.journal_lines l JOIN accounting.accounts a ON a.ledger_id=l.ledger_id AND a.id=l.account_id WHERE l.ledger_id=? AND a.type='expense'", [$repository->ledger->id])->amount;
    }

    public function test_rejection_commits_evidence_correction_retains_both_transcripts_and_reuses_identity(): void
    {
        [$repository,$service] = $this->setupLedger();
        $input = $this->input('receipt-one-cent-error.rows.txt');
        try {
            $service->import($input, new ProcessingBudget(719000, 0));
            $this->fail('One cent error accepted');
        } catch (ReceiptRejected $rejected) {
            $payload = $rejected->receiptPayload;
        }
        $this->assertSame(0, $repository->query('journals')->count());
        $this->assertSame(1, $repository->query('receipt_facts')->count());
        $rejected = $service->facts($payload['sourceRevisionId']);
        $corrected = $service->correction(hash('sha256', $input['bytes']), file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt')), 'corrected', '2026-01-17T12:00:00Z', new ProcessingBudget(719000, 0));
        $this->assertSame($rejected['receiptId'], $corrected['receiptId']);
        $accepted = $service->facts($corrected['sourceRevisionId']);
        $this->assertTrue($accepted['report']['ok']);
        $this->assertSame($payload['sourceRevisionId'], $service->source($corrected['sourceRevisionId'])['previousRevisionId']);
        $this->assertSame($input['rowsText'], $service->readObject($accepted['originalRowsObject']['sha256']));
        $this->assertSame(file_get_contents(base_path('../docs/rebuild/fixtures/receipt-corrected.rows.txt')), $service->readObject($accepted['correctedRowsObject']['sha256']));
        $this->assertSame(0, $repository->query('journals')->count());
        $this->assertContains('receipt_payment_unresolved', array_column($corrected['reviews'], 'code'));
        $count = $repository->query('source_revisions')->count();
        $this->assertTrue($service->import($input, new ProcessingBudget(719000, 0))['duplicate']);
        $this->assertSame($count, $repository->query('source_revisions')->count());
    }

    public function test_frozen_receipt_first_and_statement_first_converge_per_owner_without_duplicate_expense(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                foreach (['receipt-first', 'statement-first'] as $order) {
                    [$repository,$service,$reconciliation] = $this->setupLedger();
                    if ($order === 'statement-first') {
                        $this->statement($repository);
                    }
                    $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
                    $revision = $receipt['sourceRevisionId'];
                    if ($order === 'receipt-first') {
                        $this->assertSame(0, $repository->query('journals')->count());
                        $funded = $reconciliation->reconcile(['key' => 'fund', 'receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-01-17T12:00:00Z']);
                        $this->assertCount(1, $funded['purchaseIds']);
                    }
                    $this->assertSame(13000, $this->expense($repository));
                    $products = new ReceiptProducts($repository);
                    foreach ([1, 2] as $occurrence) {
                        $line = SourceIdentity::line($revision, $occurrence);
                        $match = $products->latest('product_match_revisions', 'id', $line);
                        $product = $products->product($match['productId']);
                        $products->decide(['key' => 'product:'.$occurrence, 'kind' => 'product_update', 'subjectId' => $product['id'], 'payload' => ['name' => $product['name'], 'category' => $occurrence === 1 ? 'pantry' : 'personal_care', 'unit' => 'un'], 'recordedAt' => '2026-01-17T12:00:00Z']);
                        $products->decide(['key' => 'approve:'.$occurrence, 'kind' => 'product_match', 'subjectId' => $line, 'payload' => ['productId' => $product['id']], 'recordedAt' => '2026-01-17T12:00:00Z']);
                    }
                    $allocation = [['sourceLineId' => SourceIdentity::line($revision, 1), 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 8000]];
                    $base = ['receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
                    $partial = $reconciliation->reconcile([...$base, 'key' => 'partial', 'expectedPurchaseVersion' => $repository->purchase($reconciliation->latest($receipt['receiptId'])['purchaseId'])['version'], 'itemAllocations' => $allocation]);
                    $purchase = $repository->purchase($partial['purchaseIds'][0]);
                    $this->assertSame([8000, 5000], array_column($purchase['allocations'], 'minor'));
                    $this->assertSame('expense:unallocated', $purchase['allocations'][1]['accountId']);
                    $allocation[] = ['sourceLineId' => SourceIdentity::line($revision, 2), 'accountId' => 'expense:personal:hygiene', 'purposeId' => 'personal', 'minor' => 5000];
                    $reconciliation->reconcile([...$base, 'key' => 'full', 'expectedPurchaseVersion' => $purchase['version'], 'itemAllocations' => $allocation]);
                    if ($order === 'receipt-first') {
                        $this->statement($repository);
                    }
                    $this->assertSame(1, $repository->query('purchases')->count());
                    $this->assertSame(13000, $this->expense($repository));
                    $report = (new ReportSnapshot($repository))->read();
                    $this->assertSame(13000, array_sum(array_column(array_filter($report['facts'], fn ($fact) => $fact['kind'] === 'purchase'), 'minor')));
                    $this->assertSame(13000, array_sum(array_column(array_filter($report['facts'], fn ($fact) => $fact['kind'] === 'billing'), 'minor')));
                    $this->assertSame(13000, array_sum(array_column($report['allocations'], 'netMinor')));

                    $balances = DB::selectOne("SELECT sum(CASE WHEN account_id='synthetic-visa-a:ARS:billed' THEN credit_minor-debit_minor ELSE 0 END) AS billed,sum(CASE WHEN account_id='synthetic-visa-a:ARS:unbilled' THEN credit_minor-debit_minor ELSE 0 END) AS unbilled FROM accounting.journal_lines WHERE ledger_id=?", [$repository->ledger->id]);
                    $this->assertSame([13000, 0], [(int) $balances->billed, (int) $balances->unbilled]);
                    $replay = $service->import($this->input(), new ProcessingBudget(719000, 0));
                    $this->assertTrue($replay['duplicate']);
                    $this->assertSame(1, $repository->query('purchases')->count());
                }
            }
        } finally {
            DB::rollBack();
        }
    }

    private function allocatedReceipt(): array
    {
        [$repository, $service, $links] = $this->setupLedger();
        $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
        $revision = $receipt['sourceRevisionId'];
        $base = ['receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
        $funded = $links->reconcile([...$base, 'key' => 'fund']);
        $products = new ReceiptProducts($repository);
        $items = [];
        foreach ([1, 2] as $position) {
            $line = SourceIdentity::line($revision, $position);
            $match = $products->latest('product_match_revisions', 'id', $line);
            $product = $products->product($match['productId']);
            $products->decide(['key' => 'product:'.$position, 'kind' => 'product_update', 'subjectId' => $product['id'], 'payload' => ['name' => $product['name'], 'category' => 'pantry', 'unit' => 'un'], 'recordedAt' => $base['recordedAt']]);
            $products->decide(['key' => 'approve:'.$position, 'kind' => 'product_match', 'subjectId' => $line, 'payload' => ['productId' => $product['id']], 'recordedAt' => $base['recordedAt']]);
            $items[] = ['sourceLineId' => $line, 'accountId' => $position === 1 ? 'expense:food:groceries:pantry' : 'expense:personal:hygiene', 'purposeId' => $position === 1 ? 'food' : 'personal', 'minor' => $position === 1 ? 8000 : 5000];
        }
        $links->reconcile([...$base, 'key' => 'allocate', 'expectedPurchaseVersion' => 1, 'itemAllocations' => $items]);

        return [$repository, $service, $links, $receipt, $base, $items, $funded['purchaseIds'][0]];
    }

    public function test_item_allocations_survive_unlink_relink_and_legacy_empty_decisions(): void
    {
        DB::beginTransaction();
        try {
            [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
            $journals = $repository->query('journals')->get()->all();
            $active = $links->latest($receipt['receiptId']);
            $links->unlink(['key' => 'unlink', 'receiptRevisionId' => $base['receiptRevisionId'], 'expectedPreviousDecisionId' => $active['id'], 'recordedAt' => $base['recordedAt']]);
            $links->reconcile([...$base, 'key' => 'relink', 'expectedPreviousDecisionId' => $links->latest($receipt['receiptId'])['id']]);
            $this->assertEquals($items, $links->latest($receipt['receiptId'])['itemAllocations']);
            $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
            $this->assertEquals($journals, $repository->query('journals')->get()->all());

            // Old installations can already have empty association-only link payloads.
            $legacy = [...$links->latest($receipt['receiptId']), 'id' => (string) Str::uuid(), 'key' => 'legacy-empty', 'previousDecisionId' => $links->latest($receipt['receiptId'])['id'], 'allocation' => null, 'itemAllocations' => []];
            $repository->transaction(fn () => $repository->insert('receipt_link_decisions', ['id' => $legacy['id'], 'key' => $legacy['key'], 'receipt_id' => $legacy['receiptId'], 'receipt_revision_id' => $legacy['receiptRevisionId'], 'purchase_id' => $legacy['purchaseId'], 'card_id' => $legacy['cardId'], 'action' => 'link', 'previous_decision_id' => $legacy['previousDecisionId'], 'recorded_at' => $legacy['recordedAt'], 'payload' => LedgerRepository::json($legacy)]));
            $this->assertEquals($items, $service->detail($receipt['receiptId'])['link']['itemAllocations']);
            $snapshot = (new ReportSnapshot($repository))->read();
            $this->assertSame(array_column($items, 'accountId'), array_column($snapshot['allocations'], 'accountId'));
            $this->assertSame([8000, 5000], array_column($snapshot['allocations'], 'netMinor'));
            $this->assertEquals($journals, $repository->query('journals')->get()->all());
            $this->assertSame([], json_decode($repository->query('receipt_link_decisions')->where('id', $legacy['id'])->value('payload'), true)['itemAllocations']);

            $links->reconcile([...$base, 'key' => 'aggregate-reset', 'expectedPurchaseVersion' => 2, 'allocation' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 13000]]]);
            $this->assertSame([], $links->latest($receipt['receiptId'])['itemAllocations']);
            $this->assertSame('expense:unallocated', $repository->purchase($purchaseId)['allocations'][0]['accountId']);
        } finally {
            DB::rollBack();
        }
    }

    public function test_stale_or_missing_purchase_version_cannot_overwrite_merchant_classification(): void
    {
        [$repository, $service, $links, $receipt, $base, $items, $purchaseId] = $this->allocatedReceipt();
        app('auth')->forgetGuards();
        $this->actingAs($repository->ledger->owner, 'web');
        $detail = $this->getJson('/api/v1/receipts/'.$receipt['receiptId'])->assertOk()->assertJsonPath('purchaseVersion', 2)->json();
        $this->postJson('/api/v1/merchant-review', ['kind' => 'purchase_classification', 'purchaseId' => $purchaseId, 'cardId' => 'synthetic-visa-a', 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedVersion' => 2], ['Idempotency-Key' => 'other-tab'])->assertOk();
        $this->assertSame($detail['link']['id'], $links->latest($receipt['receiptId'])['id']);
        $journals = $repository->query('journals')->count();
        $decisions = $repository->query('receipt_link_decisions')->count();
        $body = [...$base, 'purchaseId' => $purchaseId, 'itemAllocations' => $items, 'expectedPreviousDecisionId' => $detail['link']['id'], 'expectedPurchaseVersion' => $detail['purchaseVersion']];
        $url = '/api/v1/receipts/'.$receipt['receiptId'].'/reconciliation';
        $this->postJson($url, $body, ['Idempotency-Key' => 'stale-form'])->assertConflict()->assertJsonPath('error.code', 'stale_purchase_version');
        unset($body['expectedPurchaseVersion']);
        $this->postJson($url, $body, ['Idempotency-Key' => 'missing-version'])->assertConflict()->assertJsonPath('error.code', 'stale_purchase_version');
        $this->assertSame($journals, $repository->query('journals')->count());
        $this->assertSame($decisions, $repository->query('receipt_link_decisions')->count());
        $this->assertSame('expense:home:cleaning', $repository->purchase($purchaseId)['allocations'][0]['accountId']);
        $fresh = $this->getJson('/api/v1/receipts/'.$receipt['receiptId'])->assertOk()->assertJsonPath('purchaseVersion', 3)->json();
        $body['expectedPurchaseVersion'] = $fresh['purchaseVersion'];
        $this->postJson($url, $body, ['Idempotency-Key' => 'fresh-form'])->assertOk();
        $this->assertSame(4, $repository->purchase($purchaseId)['version']);
        $journals = $repository->query('journals')->count();
        $this->postJson($url, $body, ['Idempotency-Key' => 'fresh-form'])->assertOk()->assertJsonPath('duplicate', true);
        $this->assertSame($journals, $repository->query('journals')->count());
    }

    private function rejects(string $code, callable $work): void
    {
        try {
            $work();
            $this->fail('Expected '.$code);
        } catch (AccountingError $error) {
            $this->assertSame($code, $error->errorCode);
        }
    }

    public function test_link_conflicts_unlink_history_and_product_operations_preserve_principal(): void
    {
        DB::beginTransaction();
        try {
            [$repository,$service,$links] = $this->setupLedger();
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $revision = $receipt['sourceRevisionId'];
            $base = ['key' => 'fund', 'receiptRevisionId' => $revision, 'cardId' => 'synthetic-visa-a', 'paymentVerified' => true, 'purchaseId' => null, 'allocation' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-01-18T12:00:00Z'];
            $funded = $links->reconcile($base);
            $active = $links->latest($receipt['receiptId']);
            $this->assertTrue($links->reconcile([...$base, 'recordedAt' => '2026-01-19T12:00:00Z'])['duplicate']);
            $this->rejects('command_conflict', fn () => $links->reconcile([...$base, 'paymentVerified' => false]));
            $this->rejects('stale_receipt_link', fn () => $links->reconcile([...$base, 'key' => 'stale']));
            $products = new ReceiptProducts($repository);
            $lines = [SourceIdentity::line($revision, 1), SourceIdentity::line($revision, 2)];
            $matches = array_map(fn ($line) => $products->latest('product_match_revisions', 'id', $line), $lines);
            $canonical = array_map(fn ($match) => $products->product($match['productId']), $matches);
            foreach ($canonical as $i => $product) {
                $products->decide(['key' => 'approve:'.$i, 'kind' => 'product_update', 'subjectId' => $product['id'], 'expectedSeq' => $product['seq'], 'payload' => ['name' => $product['name'], 'category' => 'pantry', 'unit' => 'un'], 'recordedAt' => $base['recordedAt']]);
                $this->assertFalse($products->latest('product_match_revisions', 'id', $lines[$i])['reviewed']);
                $products->decide(['key' => 'match:'.$i, 'kind' => 'product_match', 'subjectId' => $lines[$i], 'payload' => ['productId' => $product['id']], 'recordedAt' => $base['recordedAt']]);
            }
            $code = $products->current('product_code_revisions')[0];
            $source = $code['productId'];
            $target = $canonical[0]['id'] === $source ? $canonical[1]['id'] : $canonical[0]['id'];
            $moved = $products->decide(['key' => 'move', 'kind' => 'move_code', 'subjectId' => $code['id'], 'expectedSeq' => $code['seq'], 'payload' => ['targetId' => $target], 'recordedAt' => $base['recordedAt']]);
            $this->assertSame($target, $products->latest('product_code_revisions', 'id', $code['id'])['productId']);
            $affected = array_values(array_filter($products->current('product_match_revisions'), fn ($row) => $row['productId'] === $target));
            $this->assertTrue(count(array_filter($affected, fn ($row) => ! $row['reviewed'])) > 0);
            $products->decide(['key' => 'merge', 'kind' => 'product_merge', 'subjectId' => $source, 'payload' => ['targetId' => $target], 'recordedAt' => $base['recordedAt']]);
            $this->assertSame($target, $products->product($source)['redirectId']);
            $this->assertSame(13000, $this->expense($repository));
            $this->assertSame(13000, $repository->purchase($funded['purchaseIds'][0])['principalMinor']);
            $unlink = ['key' => 'unlink', 'receiptRevisionId' => $revision, 'expectedPreviousDecisionId' => $active['id'], 'recordedAt' => $base['recordedAt']];
            $links->unlink($unlink);
            $links->unlink([...$unlink, 'recordedAt' => '2026-01-19T12:00:00Z']);
            $this->assertCount(0, $links->active());
            $this->assertSame($active['id'], $links->latest($receipt['receiptId'])['previousDecisionId']);
            $this->rejects('command_conflict', fn () => $links->unlink([...$unlink, 'expectedPreviousDecisionId' => null]));
            $this->assertSame(2, $repository->query('receipt_link_decisions')->count());
            $this->assertSame(13000, $this->expense($repository));
            [$other,$otherService] = $this->setupLedger();
            $this->assertNull($otherService->detail($receipt['receiptId']));
            $this->assertNull($otherService->facts($revision));
            $this->rejects('missing_review_subject', fn () => (new ReceiptProducts($other))->product($target));
        } finally {
            DB::rollBack();
        }
    }

    public function test_historical_link_and_unlink_chain_preserves_only_opening_journal(): void
    {
        DB::beginTransaction();
        try {
            [$repository,$service,$links] = $this->setupLedger();
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            $opening = ['id' => (string) Str::uuid(), 'commandKey' => 'opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 13000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 13000, 'purchaseId' => null, 'purposeId' => null]]];
            $this->assertSame('posted', (new FinancialCommands($repository))->post($opening)['status']);
            $statement = $this->statement($repository, true);
            $receipt = $service->import($this->input(), new ProcessingBudget(719000, 0));
            $association = new HistoricalAssociations($service);
            $base = ['key' => 'historical-link', 'receiptRevisionId' => $receipt['sourceRevisionId'], 'sourceLineId' => SourceIdentity::line($statement['sourceRevisionId'], 1), 'action' => 'link', 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-02-02T12:00:00Z'];
            $linked = $association->decide($base);
            $this->assertEquals($linked, $association->decide([...$base, 'recordedAt' => '2026-02-03T12:00:00Z']));
            $this->assertCount(1, $association->current());
            $this->rejects('stale_historical_association', fn () => $association->decide([...$base, 'key' => 'stale']));
            $unlinked = $association->decide([...$base, 'key' => 'unlink', 'action' => 'unlink', 'expectedPreviousDecisionId' => $linked['id']]);
            $this->assertSame($linked['id'], $unlinked['previousDecisionId']);
            $this->assertCount(0, $association->current());
            $this->assertSame(1, $repository->query('journals')->count());
            $this->assertSame(0, $repository->query('purchases')->count());
            $this->assertSame(0, $this->expense($repository));
        } finally {
            DB::rollBack();
        }
    }

    public function test_postgresql_receipt_product_foreign_key_and_immutable_evidence_guards(): void
    {
        DB::beginTransaction();
        try {
            [$a,$aService] = $this->setupLedger();
            [$b,$bService] = $this->setupLedger();
            $receiptA = $aService->import($this->input(), new ProcessingBudget(719000, 0));
            $receiptB = $bService->import($this->input(), new ProcessingBudget(719000, 0));
            $line = SourceIdentity::line($receiptA['sourceRevisionId'], 1);
            $productA = (new ReceiptProducts($a))->latest('product_match_revisions', 'id', $line)['productId'];
            $productB = (new ReceiptProducts($b))->latest('product_match_revisions', 'id', SourceIdentity::line($receiptB['sourceRevisionId'], 1))['productId'];
            $this->assertNotSame($productA, $productB);
            $row = ['id' => $line, 'product_id' => $productA, 'payload' => '{}'];
            $a->transaction(fn () => $a->insert('product_match_revisions', $row));
            DB::statement('SAVEPOINT cross_owner_product');
            try {
                DB::table('accounting.product_match_revisions')->insert(['ledger_id' => $a->ledger->id, 'row_id' => (string) Str::uuid(), ...$row, 'product_id' => $productB]);
                $this->fail('Cross-owner product reference accepted');
            } catch (QueryException $error) {
                $this->assertSame('23503', $error->errorInfo[0]);
                $this->assertStringContainsString('product_match_revisions_ledger_id_product_id_fkey', $error->getMessage());
                DB::statement('ROLLBACK TO SAVEPOINT cross_owner_product');
            }
            DB::statement('SAVEPOINT immutable_receipt');
            try {
                DB::table('accounting.receipt_facts')->where('ledger_id', $a->ledger->id)->update(['payload' => '{}']);
                $this->fail('Receipt facts were changed');
            } catch (QueryException $error) {
                $this->assertStringContainsString('immutable_record', $error->getMessage());
                DB::statement('ROLLBACK TO SAVEPOINT immutable_receipt');
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_confirmed_historical_full_refund_reduces_opening_debt_without_fabricating_purchase(): void
    {
        DB::beginTransaction();
        try {
            foreach (['a', 'b'] as $owner) {
                [$repository,$service] = $this->setupLedger();
                $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'opening-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
                (new FinancialCommands($repository))->post(['id' => (string) Str::uuid(), 'commandKey' => 'opening', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-02-01', 'recordedAt' => '2026-02-01T12:00:00Z', 'kind' => 'opening', 'reversesId' => null, 'evidenceIds' => ['opening-proof'], 'lines' => [['accountId' => 'equity:opening', 'debitMinor' => 13000, 'creditMinor' => 0, 'purchaseId' => null, 'purposeId' => null], ['accountId' => 'synthetic-visa-a:ARS:billed', 'debitMinor' => 0, 'creditMinor' => 13000, 'purchaseId' => null, 'purposeId' => null]]]);
                $original = $this->statement($repository, true);
                $raw = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/visa.expected.json')));
                $raw->period->closing_date = '2026-03-31';
                $raw->declared_totals = [];
                $raw->transactions = [(object) ['section' => 'purchases', 'date' => '2026-03-05', 'description' => 'DEVOLUCION COTO SYNTHETIC', 'ars' => -130, 'usd' => null, 'installment_number' => null, 'installment_count' => null, 'raw_line' => '05-mar-26 DEVOLUCION COTO -130,00']];
                $refund = (new StatementImporter($repository, app(DocumentStore::class)))->import(['key' => 'refund', 'cardId' => 'synthetic-visa-a', 'filename' => 'synthetic_refund_2026_03.pdf', 'pdf' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf'))."\n% synthetic full-refund seam", 'rawJson' => json_encode($raw), 'recordedAt' => '2026-03-31T12:00:00Z', 'appRevision' => 'receipt-acceptance']);
                $input = ['key' => 'full-refund', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'originalSourceLineId' => SourceIdentity::line($original['sourceRevisionId'], 1), 'refundSourceLineId' => SourceIdentity::line($refund['sourceRevisionId'], 1), 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'confirmedFullRefund' => true, 'recordedAt' => '2026-04-01T12:00:00Z'];
                $useCase = new HistoricalRefund($service);
                $this->rejects('full_refund_confirmation_required', fn () => $useCase->post([...$input, 'confirmedFullRefund' => false]));
                (new SourceClassification($repository))->decide(['key' => 'pre-refund-classification', 'sourceLineId' => $input['originalSourceLineId'], 'accountId' => 'expense:home:cleaning', 'purposeId' => 'home', 'scope' => 'selected', 'match' => null, 'expectedPreviousDecisionId' => null, 'recordedAt' => '2026-03-31T13:00:00Z']);
                $previous = $repository->query('review_events')->where('subject_id', $input['originalSourceLineId'])->where('code', 'historical_source_classification')->orderByDesc('ordinal')->value('id');
                $this->assertSame('posted', $useCase->post($input)['status']);
                $current = $repository->query('review_events')->where('subject_id', $input['originalSourceLineId'])->where('code', 'historical_source_classification')->orderByDesc('ordinal')->first();
                $this->assertSame($previous, $current->prior_decision_id);
                $this->assertSame('food', json_decode($current->params, true)['purposeId']);

                $this->assertSame('duplicate', $useCase->post([...$input, 'key' => 'replay', 'recordedAt' => '2026-04-02T12:00:00Z'])['status']);
                $this->assertSame(-13000, $this->expense($repository));
                $this->assertSame(2, $repository->query('journals')->count());
                $this->assertSame(0, $repository->query('purchases')->count());
                $billed = DB::selectOne("SELECT sum(credit_minor-debit_minor) AS minor FROM accounting.journal_lines WHERE ledger_id=? AND account_id='synthetic-visa-a:ARS:billed'", [$repository->ledger->id]);
                $this->assertSame(0, (int) $billed->minor);
            }
        } finally {
            DB::rollBack();
        }
    }
}
