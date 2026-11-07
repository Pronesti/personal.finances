<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\ReceiptProducts;
use App\Domain\Evidence\ReceiptReconciliation;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\PrivateUpload;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Processing\ReceiptExtraction;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ReceiptController extends Controller
{
    private function service(Request $request): ReceiptService
    {
        return new ReceiptService(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')), app(DocumentStore::class));
    }

    private function key(Request $request): string
    {
        $value = $request->header('Idempotency-Key');
        validator(['key' => $value], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();

        return $value;
    }

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:50']]);
        $service = $this->service($request);

        return response()->json($service->repository->readSnapshot(function () use ($service, $input) {
            $all = array_reverse($service->currentReceipts());
            $page = (int) ($input['page'] ?? 1);
            $size = (int) ($input['per_page'] ?? 20);

            return ['data' => array_map(fn ($row) => ['id' => $row['receiptId'], 'revisionId' => $row['revisionId'], 'date' => $row['date'], 'fiscalId' => $row['fiscalId'], 'totalMinor' => $row['totalMinor'], 'admission' => $row['admission'], 'report' => $row['report']], array_slice($all, ($page - 1) * $size, $size)), 'meta' => ['page' => $page, 'per_page' => $size, 'total' => count($all)]];
        }));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        abort_unless(ctype_digit($id) && strlen($id) <= 16 && (int) $id <= 9007199254740991, 404);
        $service = $this->service($request);
        $detail = $service->repository->readSnapshot(fn () => $service->detail((int) $id));
        abort_if($detail === null, 404);

        return response()->json($detail);
    }

    public function store(Request $request, ReceiptExtraction $extractor, PrivateUpload $uploads): JsonResponse
    {
        $key = $this->key($request);
        $file = PrivateUpload::validatedFile($request, 41943040);
        $budget = ProcessingBudget::fromIngress($request);
        $bytes = $file->get();
        $service = $this->service($request);
        $hash = hash('sha256', $bytes);
        if (($accepted = $service->acceptedForHash($hash)) !== null) {
            return response()->json($service->import(['key' => $key, 'bytes' => $bytes, 'rowsText' => '', 'scale' => $accepted['scale'], 'recordedAt' => now()->toIso8601String(), 'appRevision' => config('tarjetas.revision')], $budget));
        }
        $extraction = $uploads->withPdf($bytes, fn ($path) => $extractor->pdf($path, $budget));

        return response()->json($service->import(['key' => $key, 'bytes' => $bytes, 'rowsText' => $extraction['rowsText'], 'scale' => $extraction['scale'], 'recordedAt' => now()->toIso8601String(), 'appRevision' => config('tarjetas.revision')], $budget));
    }

    public function correction(Request $request): JsonResponse
    {
        $input = $request->validate(['sha256' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D']]);

        return $this->correct($request, $input['sha256']);
    }

    public function correct(Request $request, string $hash): JsonResponse
    {
        $key = $this->key($request);
        $input = $request->validate(['rowsText' => ['required', 'string', 'max:4194304']]);
        // Scope authorization precedes worker access and does not expose other owners' hashes.
        abort_unless($this->service($request)->repository->query('source_revisions')->where('kind', 'receipt')->where('document_hash', $hash)->exists(), 404);

        return response()->json($this->service($request)->correction($hash, $input['rowsText'], $key, now()->toIso8601String(), ProcessingBudget::fromIngress($request)));
    }

    public function reconcile(Request $request, string $id): JsonResponse
    {
        $key = $this->key($request);
        $service = $this->service($request);
        $detail = $service->detail((int) $id);
        abort_if($detail === null, 404);
        $input = $request->validate([
            'receiptRevisionId' => ['required', 'string', 'max:300'], 'cardId' => ['present', 'nullable', 'string', 'max:200'],
            'paymentVerified' => ['required', 'boolean'], 'purchaseId' => ['present', 'nullable', 'string', 'max:300'],
            'expectedPreviousDecisionId' => ['present', 'nullable', 'uuid'], 'expectedPurchaseVersion' => ['sometimes', 'integer', 'min:1'],
            'allocation' => ['sometimes', 'nullable', 'array', 'max:500'], 'itemAllocations' => ['sometimes', 'array', 'max:500'],
            'allocation.*.accountId' => ['required', 'string', 'max:200'], 'allocation.*.purposeId' => ['required', 'string', 'max:200'], 'allocation.*.minor' => ['required', 'integer', 'min:1', 'max:9007199254740991'],
            'itemAllocations.*.sourceLineId' => ['required', 'string', 'max:400'], 'itemAllocations.*.accountId' => ['required', 'string', 'max:200'], 'itemAllocations.*.purposeId' => ['required', 'string', 'max:200'], 'itemAllocations.*.minor' => ['required', 'integer', 'min:1', 'max:9007199254740991'],
        ]);
        abort_unless(($service->facts($input['receiptRevisionId'])['receiptId'] ?? null) === (int) $id, 404);
        if ($input['cardId'] !== null) {
            abort_unless($service->repository->query('cards')->where('id', $input['cardId'])->exists(), 404);
        }
        if ($input['purchaseId'] !== null) {
            abort_unless($service->repository->purchase($input['purchaseId']) !== null, 404);
        }

        return response()->json((new ReceiptReconciliation($service))->reconcile([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }

    public function unlink(Request $request, string $id): JsonResponse
    {
        $key = $this->key($request);
        $service = $this->service($request);
        $input = $request->validate(['receiptRevisionId' => ['required', 'string', 'max:300'], 'expectedPreviousDecisionId' => ['present', 'nullable', 'uuid']]);
        abort_unless(($service->facts($input['receiptRevisionId'])['receiptId'] ?? null) === (int) $id, 404);
        (new ReceiptReconciliation($service))->unlink([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]);

        return response()->json(['status' => 'unlinked']);
    }

    public function review(Request $request): JsonResponse
    {
        $key = $this->key($request);
        $input = $request->validate(['kind' => ['required', Rule::in(['product_update', 'product_match', 'move_code', 'product_merge'])], 'subjectId' => ['required', 'string', 'max:400'], 'expectedSeq' => ['required', 'integer', 'min:1'], 'payload' => ['required', 'array'], 'payload.name' => ['required_if:kind,product_update', 'string', 'max:300'], 'payload.category' => ['required_if:kind,product_update', Rule::in(ReceiptProducts::CATEGORIES)], 'payload.unit' => ['required_if:kind,product_update', Rule::in(['un', 'kg'])], 'payload.productId' => ['required_if:kind,product_match', 'string'], 'payload.targetId' => ['required_if:kind,move_code,product_merge', 'string']]);
        $products = new ReceiptProducts($this->service($request)->repository);
        $table = match ($input['kind']) {
            'product_update', 'product_merge' => 'product_revisions', 'product_match' => 'product_match_revisions', 'move_code' => 'product_code_revisions'
        };
        abort_if($products->latest($table, $table === 'product_revisions' ? 'product_id' : 'id', $input['subjectId']) === null, 404);
        foreach (['productId', 'targetId'] as $field) {
            if (isset($input['payload'][$field])) {
                abort_if($products->latest('product_revisions', 'product_id', $input['payload'][$field]) === null, 404);
            }
        }

        return response()->json($products->decide([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }
}
