<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reviews\MerchantReviews;
use App\Domain\Reviews\SourceClassification;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class MerchantReviewController extends Controller
{
    private function service(Request $request): MerchantReviews
    {
        return new MerchantReviews(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')));
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json([...$this->service($request)->read(), 'historical' => (new SourceClassification(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'))))->eligible()]);
    }

    public function preview(Request $request): JsonResponse
    {
        $input = $request->validate(['cardId' => ['required', 'string', 'max:200'], 'match' => ['required', 'string', 'min:3', 'max:300']]);
        abort_unless((new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')))->query('cards')->where('id', $input['cardId'])->exists(), 404);

        return response()->json($this->service($request)->preview($input['cardId'], $input['match']));
    }

    public function command(Request $request): JsonResponse
    {
        $input = $request->validate(['kind' => ['required', Rule::in(['purchase_classification', 'merchant_merge'])],
            'purchaseId' => ['required_if:kind,purchase_classification', 'string', 'max:300'], 'cardId' => ['required_if:kind,purchase_classification', 'string', 'max:200'],
            'accountId' => ['required_if:kind,purchase_classification', 'string', 'max:200'], 'purposeId' => ['required_if:kind,purchase_classification', 'string', 'max:200'],
            'scope' => ['required_if:kind,purchase_classification', Rule::in(['selected', 'future_rule', 'matching_history'])], 'expectedVersion' => ['required_if:kind,purchase_classification', 'integer', 'min:1'],
            'match' => ['present_if:kind,purchase_classification', 'nullable', 'string', 'max:300'],
            'confirmedPurchaseIds' => ['required_if:scope,matching_history', 'array', 'max:500'], 'confirmedPurchaseIds.*' => ['required', 'string', 'max:300', 'distinct'],
            'confirmHistory' => ['required_if:scope,matching_history', 'boolean'], 'expectedFingerprint' => ['required_if:scope,matching_history', 'string', 'regex:/^[a-f0-9]{64}$/D'],
            'sourceId' => ['required_if:kind,merchant_merge', 'string', 'max:200'], 'targetId' => ['required_if:kind,merchant_merge', 'string', 'max:200'], 'expectedSeq' => ['required_if:kind,merchant_merge', 'integer', 'min:1']]);
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();

        return response()->json($this->service($request)->decide([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }

    public function sourcePreview(Request $request): JsonResponse
    {
        $input = $request->validate(['sourceLineId' => ['required', 'string', 'max:400'], 'match' => ['required', 'string', 'min:3', 'max:300']]);

        return response()->json((new SourceClassification(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'))))->preview($input['sourceLineId'], $input['match']));
    }

    public function sourceClassification(Request $request): JsonResponse
    {
        $input = $request->validate(['sourceLineId' => ['required', 'string', 'max:400'], 'accountId' => ['required', 'string', 'max:200'], 'purposeId' => ['required', 'string', 'max:200'], 'scope' => ['required', Rule::in(['selected', 'future_rule', 'matching_history'])], 'match' => ['present', 'nullable', 'string', 'max:300'], 'expectedPreviousDecisionId' => ['present', 'nullable', 'string', 'max:400'], 'confirmedSourceLineIds' => ['required_if:scope,matching_history', 'array', 'max:500'], 'confirmedSourceLineIds.*' => ['required', 'string', 'max:400', 'distinct'], 'confirmHistory' => ['required_if:scope,matching_history', 'boolean'], 'expectedFingerprint' => ['required_if:scope,matching_history', 'string', 'regex:/^[a-f0-9]{64}$/D']]);
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();

        return response()->json((new SourceClassification(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'))))->decide([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }
}
