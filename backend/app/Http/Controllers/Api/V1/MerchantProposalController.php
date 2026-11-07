<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reviews\MerchantProposalProvider;
use App\Domain\Reviews\MerchantProposals;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class MerchantProposalController extends Controller
{
    private function service(Request $request): MerchantProposals
    {
        return new MerchantProposals(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')), app(MerchantProposalProvider::class));
    }

    private function input(Request $request): array
    {
        return $request->validate(['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']]);
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['proposals' => $this->service($request)->read()]);
    }

    public function generate(Request $request): JsonResponse
    {
        $request->merge(['key' => $request->header('Idempotency-Key')]);

        return response()->json($this->service($request)->generate([...$this->input($request), 'recordedAt' => now()->toIso8601String()]));
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        $request->merge(['key' => $request->header('Idempotency-Key')]);
        $input = $request->validate(['action' => ['required', Rule::in(['accept', 'reject'])], 'expectedSeq' => ['required', 'integer', 'min:1'], 'purchaseId' => ['required_if:action,accept', 'string', 'max:300'], 'cardId' => ['required_if:action,accept', 'string', 'max:200'], 'accountId' => ['required_if:action,accept', 'string', 'max:200'], 'purposeId' => ['required_if:action,accept', 'string', 'max:200'], 'scope' => ['required_if:action,accept', Rule::in(['selected', 'future_rule', 'matching_history'])], 'expectedVersion' => ['required_if:action,accept', 'integer', 'min:1'], 'match' => ['present_if:action,accept', 'nullable', 'string', 'max:300'], 'confirmedPurchaseIds' => ['required_if:scope,matching_history', 'array', 'max:500'], 'confirmedPurchaseIds.*' => ['string', 'max:300', 'distinct'], 'confirmHistory' => ['required_if:scope,matching_history', 'boolean'], 'expectedFingerprint' => ['required_if:scope,matching_history', 'string', 'regex:/^[a-f0-9]{64}$/D']]);

        return response()->json($this->service($request)->decide([...$input, ...$this->input($request), 'id' => $id, 'recordedAt' => now()->toIso8601String()]));
    }
}
