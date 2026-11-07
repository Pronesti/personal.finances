<?php

namespace Tests\Feature;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptService;
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
}
