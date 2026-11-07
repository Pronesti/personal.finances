<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\ProcessingBudget;
use App\Models\Ledger;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class ProductReviewWorkflowsTest extends PostgresTestCase
{
    public function test_rules_rematching_merging_and_code_movement_preserve_printed_facts_and_require_review_again(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $owners = [Ledger::factory()->create(), Ledger::factory()->create()];
        foreach ($owners as $owner) {
            $repository = new LedgerRepository($owner);
            app(CatalogBootstrap::class)->initialize($repository, []);
            $service = new ReceiptService($repository, app(DocumentStore::class));
            $service->import(['key' => 'same-import', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-valid.rows.txt')), 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'product-review-test'], new ProcessingBudget(719000, 0));
            app('auth')->forgetGuards();
            $this->actingAs($owner->owner, 'web');
            $before = $this->getJson('/api/v1/product-review')->assertOk()->json();
            $products = $before['products'];
            $target = $products[0];
            $source = $products[1];
            $code = array_values(array_filter($before['codes'], fn ($row) => $row['productId'] === $source['id']))[0];
            $this->postJson('/api/v1/product-reviews', ['kind' => 'product_update', 'subjectId' => $target['id'], 'expectedSeq' => $target['seq'], 'payload' => ['name' => 'Reviewed literal', 'category' => 'pantry', 'unit' => $target['unit']]], ['Idempotency-Key' => 'approve-target'])->assertOk();
            $rule = ['kind' => 'product_rule', 'subjectId' => Str::uuid()->toString(), 'expectedSeq' => 0, 'payload' => ['productId' => $target['id'], 'match' => 'SYNTHETIC', 'position' => 0, 'enabled' => true]];
            $this->postJson('/api/v1/product-review', $rule, ['Idempotency-Key' => 'rule'])->assertOk();
            $this->postJson('/api/v1/product-review', $rule, ['Idempotency-Key' => 'rule'])->assertOk()->assertJsonPath('duplicate', true);
            $this->postJson('/api/v1/product-review', $rule, ['Idempotency-Key' => 'stale-rule'])->assertStatus(409);
            $current = $this->getJson('/api/v1/product-review')->assertOk()->json();
            $rematch = ['kind' => 'product_rematch', 'subjectId' => $current['receipts'][0]['revisionId'], 'expectedSeq' => 0, 'payload' => ['expectedFingerprint' => $before['fingerprint']]];
            $this->postJson('/api/v1/product-review', $rematch, ['Idempotency-Key' => 'stale-rematch'])->assertStatus(409);
            $rematch['payload']['expectedFingerprint'] = $current['fingerprint'];
            $this->postJson('/api/v1/product-review', $rematch, ['Idempotency-Key' => 'rematch'])->assertOk();
            $this->postJson('/api/v1/product-review', $rematch, ['Idempotency-Key' => 'rematch'])->assertOk()->assertJsonPath('duplicate', true);
            $matches = (new ReceiptProducts($repository))->current('product_match_revisions');
            $this->assertCount(2, $matches);
            foreach ($matches as $match) {
                $this->assertFalse($match['reviewed']);
                $this->assertSame('code', $match['method']);
            }
            $this->postJson('/api/v1/product-reviews', ['kind' => 'move_code', 'subjectId' => $code['id'], 'expectedSeq' => $code['seq'], 'payload' => ['targetId' => $target['id']]], ['Idempotency-Key' => 'move'])->assertOk();
            $latestSource = (new ReceiptProducts($repository))->product($source['id']);
            $this->postJson('/api/v1/product-reviews', ['kind' => 'product_merge', 'subjectId' => $source['id'], 'expectedSeq' => $latestSource['seq'], 'payload' => ['targetId' => $target['id']]], ['Idempotency-Key' => 'merge'])->assertOk();
            $this->postJson('/api/v1/product-reviews', ['kind' => 'product_merge', 'subjectId' => $target['id'], 'expectedSeq' => (new ReceiptProducts($repository))->product($target['id'])['seq'], 'payload' => ['targetId' => $source['id']]], ['Idempotency-Key' => 'cycle'])->assertStatus(400)->assertJsonPath('error.code', 'invalid_product_merge');
            $after = $this->getJson('/api/v1/product-review')->assertOk()->json();
            $this->assertSame($before['items'], $after['items']);
            $this->assertSame($target['id'], (new ReceiptProducts($repository))->product($source['id'])['redirectId']);
            $this->assertSame(0, $repository->query('journals')->count());
            $ownedProductIds[] = $target['id'];
        }
        app('auth')->forgetGuards();
        $this->actingAs($owners[0]->owner, 'web');
        $this->postJson('/api/v1/product-review', ['kind' => 'product_rule', 'subjectId' => Str::uuid()->toString(), 'expectedSeq' => 0, 'payload' => ['productId' => $ownedProductIds[1], 'match' => 'foreign', 'position' => 0, 'enabled' => true]], ['Idempotency-Key' => 'foreign'])->assertNotFound();
    }

    public function test_legacy_packaged_mass_can_be_reviewed_as_units_only_with_owned_code_and_unambiguous_printed_evidence(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $owner = Ledger::factory()->create();
        $repository = new LedgerRepository($owner);
        app(CatalogBootstrap::class)->initialize($repository, []);
        (new ReceiptService($repository, app(DocumentStore::class)))->import(['key' => 'package-source', 'bytes' => file_get_contents(base_path('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf')), 'rowsText' => file_get_contents(base_path('../docs/rebuild/fixtures/receipt-valid.rows.txt')), 'scale' => 3, 'recordedAt' => '2026-01-16T12:00:00Z', 'appRevision' => 'synthetic-legacy'], new ProcessingBudget(719000, 0));
        $source = $repository->query('source_lines')->whereRaw("payload->>'descPrinted' LIKE '%RICE%'")->first();
        $printed = json_decode($source->payload, true);
        $service = new ReceiptProducts($repository);
        $match = $service->latest('product_match_revisions', 'id', $source->id);
        $product = $service->product($match['productId']);
        $service->decide(['key' => 'review-package', 'kind' => 'product_update', 'subjectId' => $product['id'], 'expectedSeq' => $product['seq'], 'payload' => ['name' => 'SYNTHETIC PACKAGED RICE', 'category' => 'pantry', 'unit' => 'un'], 'recordedAt' => '2026-01-17T00:00:00Z']);
        $cases = [['unit' => 'kg'], ['unit' => 'kg', 'qtyMilli' => 500], ['unit' => 'kg', 'ean' => '2000000000000'], ['unit' => 'kg', 'descPrinted' => 'SYNTHETIC RICE PAQ 1 KG X KG'], ['unit' => 'kg', 'descPrinted' => 'SYNTHETIC WEIGHED RICE'], ['unit' => 'kg', 'sku' => 'unowned-code']];
        foreach ($cases as $i => $changes) {
            $id = 'synthetic-legacy-unit-'.$i;
            $payload = [...$printed, ...$changes];
            $repository->transaction(function () use ($repository, $id, $payload, $source, $i) {
                $repository->insert('evidence', ['id' => $id, 'kind' => 'receipt', 'metadata' => '{}']);
                $repository->insert('source_lines', ['id' => $id, 'revision_id' => $source->revision_id, 'occurrence' => 100 + $i, 'payload' => LedgerRepository::json($payload), 'legacy_fingerprint' => hash('sha256', LedgerRepository::json($payload))]);
            });
        }
        $repository->transaction(fn () => $service->matchReceipt($source->revision_id));
        foreach ($cases as $i => $changes) {
            $id = 'synthetic-legacy-unit-'.$i;
            $match = $service->latest('product_match_revisions', 'id', $id);
            $before = $repository->query('source_lines')->where('id', $id)->value('payload');
            $input = ['key' => 'unit-review-'.$i, 'kind' => 'product_match', 'subjectId' => $id, 'expectedSeq' => $match['seq'], 'payload' => ['productId' => $product['id']], 'recordedAt' => '2026-01-18T00:00:00Z'];
            if ($i === 0) {
                $service->decide($input);
                $latest = $service->latest('product_match_revisions', 'id', $id);
                $this->assertTrue($latest['reviewed']);
                $this->assertEquals(['from' => 'kg', 'to' => 'un', 'reason' => 'packaged_mass'], $latest['unitCorrection']);
            } else {
                try {
                    $service->decide($input);
                    $this->fail('Ambiguous unit conversion accepted');
                } catch (AccountingError $error) {
                    $this->assertSame('product_unit_mismatch', $error->errorCode);
                }
            }
            $this->assertSame($before, $repository->query('source_lines')->where('id', $id)->value('payload'));
        }
        $this->assertSame(0,$repository->query('journals')->count());
    }
}
