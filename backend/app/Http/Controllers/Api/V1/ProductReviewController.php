<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\LedgerRepository;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProductReviewController extends Controller
{
    private function repository(Request $request): LedgerRepository
    {
        return new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'));
    }

    public function index(Request $request): JsonResponse
    {
        $repository = $this->repository($request);
        $products = new ReceiptProducts($repository);

        return response()->json($repository->readSnapshot(function () use ($repository, $products) {
            $service = new ReceiptService($repository, app(DocumentStore::class));
            $receipts = $service->currentReceipts();
            $active = array_column(array_filter($receipts, fn ($row) => $row['admission'] === 'accepted'), 'revisionId');
            $matches = array_values(array_filter($products->current('product_match_revisions'), fn ($row) => in_array($row['receiptRevisionId'], $active, true)));
            $items = $repository->query('source_lines')->whereIn('revision_id', $active)->orderBy('occurrence')->get()->map(fn ($row) => ['id' => $row->id, 'revisionId' => $row->revision_id, 'item' => json_decode($row->payload, true)])->all();

            return ['products' => $products->current('product_revisions', 'product_id'), 'codes' => $products->current('product_code_revisions'), 'rules' => $products->current('product_rule_revisions'), 'matches' => $matches, 'items' => $items, 'receipts' => array_map(fn ($row) => ['id' => $row['receiptId'], 'revisionId' => $row['revisionId']], array_values(array_filter($receipts, fn ($row) => $row['admission'] === 'accepted'))), 'fingerprint' => $products->fingerprint(), 'history' => $repository->query('review_decisions')->whereIn('kind', ['product_update', 'product_match', 'move_code', 'product_merge', 'product_rule', 'product_rematch'])->orderByDesc('seq')->limit(100)->get()->map(fn ($row) => ['id' => $row->id, 'kind' => $row->kind, 'subjectId' => $row->subject_id, 'recordedAt' => $row->recorded_at, 'decision' => json_decode($row->payload, true)])];
        }));
    }

    public function command(Request $request): JsonResponse
    {
        $input = $request->validate(['kind' => ['required', Rule::in(['product_rule', 'product_rematch'])], 'subjectId' => ['required', 'string', 'max:400'], 'expectedSeq' => ['required', 'integer', 'min:0'], 'payload' => ['required', 'array'], 'payload.productId' => ['required_if:kind,product_rule', 'string'], 'payload.match' => ['required_if:kind,product_rule', 'string', 'min:1', 'max:300'], 'payload.position' => ['required_if:kind,product_rule', 'integer', 'min:0', 'max:100000'], 'payload.enabled' => ['required_if:kind,product_rule', 'boolean'], 'payload.expectedFingerprint' => ['required_if:kind,product_rematch', 'string', 'regex:/^[a-f0-9]{64}$/D']]);
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();
        $repository = $this->repository($request);
        $products = new ReceiptProducts($repository);
        if ($input['kind'] === 'product_rule') {
            abort_if($products->latest('product_revisions', 'product_id', $input['payload']['productId']) === null, 404);
            if ($input['expectedSeq'] === 0) {
                validator(['id' => $input['subjectId']], ['id' => ['uuid']])->validate();
            } else {
                abort_if($products->latest('product_rule_revisions', 'id', $input['subjectId']) === null, 404);
            }
        } else {
            $receipt = (new ReceiptService($repository, app(DocumentStore::class)))->currentReceipts();
            abort_unless(in_array($input['subjectId'], array_column(array_filter($receipt, fn ($row) => $row['admission'] === 'accepted'), 'revisionId'), true), 404);
        }

        return response()->json($products->decide([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }
}
