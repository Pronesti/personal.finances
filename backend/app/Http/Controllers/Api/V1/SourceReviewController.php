<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\HistoricalAssociations;
use App\Domain\Evidence\HistoricalRefund;
use App\Domain\Evidence\ReceiptReconciliation;
use App\Domain\Evidence\ReceiptService;
use App\Domain\Ledger\LedgerRepository;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SourceReviewController extends Controller
{
    private function service(Request $request): ReceiptService
    {
        return new ReceiptService(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')), app(DocumentStore::class));
    }

    private function key(Request $request): string
    {
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();

        return $key;
    }

    public function charges(Request $request): JsonResponse
    {
        $service = $this->service($request);
        $repository = $service->repository;

        return response()->json($repository->readSnapshot(function () use ($service, $repository) {
            $statements = $repository->query('source_revisions')->where('kind', 'statement')->whereRaw("payload->>'admission'='accepted'")->orderByDesc('ordinal')->get();
            $lines = [];
            foreach ($statements as $source) {
                foreach ($repository->query('source_lines')->where('revision_id', $source->id)->orderBy('occurrence')->get() as $line) {
                    $row = json_decode($line->payload, true);
                    if (! preg_match('/(?:^|[^A-Z])COTO(?:[^A-Z]|$)/i', $row['description'] ?? '')) {
                        continue;
                    }
                    $lines[] = ['id' => $line->id, 'revisionId' => $source->id, 'cardId' => $source->card_id, 'line' => $row, 'purchaseIds' => $repository->query('source_purchase_identities')->where('source_line_id', $line->id)->pluck('purchase_id')];
                }
            }

            return ['receipts' => array_map(fn ($receipt) => ['id' => $receipt['receiptId'], 'revisionId' => $receipt['revisionId'], 'date' => $receipt['date'], 'fiscalId' => $receipt['fiscalId'], 'totalMinor' => $receipt['totalMinor'], 'admission' => $receipt['admission']], $service->currentReceipts()), 'charges' => $lines, 'financialLinks' => (new ReceiptReconciliation($service))->active(), 'historicalLinks' => (new HistoricalAssociations($service))->current(), 'financialHistory' => $repository->query('receipt_link_decisions')->orderBy('ordinal')->get()->map(fn ($row) => json_decode($row->payload, true)), 'historicalHistory' => $repository->query('historical_receipt_associations')->orderBy('ordinal')->get()->map(fn ($row) => json_decode($row->payload, true))];
        }));
    }

    public function associate(Request $request, string $id): JsonResponse
    {
        $key = $this->key($request);
        $service = $this->service($request);
        $input = $request->validate(['receiptRevisionId' => ['required', 'string', 'max:300'], 'sourceLineId' => ['present', 'nullable', 'string', 'max:400'], 'action' => ['required', Rule::in(['link', 'unlink'])], 'expectedPreviousDecisionId' => ['present', 'nullable', 'uuid']]);
        abort_unless(($service->facts($input['receiptRevisionId'])['receiptId'] ?? null) === (int) $id, 404);
        if ($input['sourceLineId'] !== null) {
            abort_unless($service->repository->query('source_lines')->where('id', $input['sourceLineId'])->exists(), 404);
        }

        return response()->json((new HistoricalAssociations($service))->decide([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }

    public function refund(Request $request): JsonResponse
    {
        $key = $this->key($request);
        $service = $this->service($request);
        $input = $request->validate(['cardId' => ['required', 'string', 'max:200'], 'currency' => ['required', Rule::in(['ARS', 'USD'])], 'originalSourceLineId' => ['required', 'string', 'max:400'], 'refundSourceLineId' => ['required', 'string', 'max:400'], 'accountId' => ['required', 'string', 'max:200'], 'purposeId' => ['required', 'string', 'max:200'], 'confirmedFullRefund' => ['required', 'boolean']]);
        foreach (['originalSourceLineId', 'refundSourceLineId'] as $field) {
            abort_unless($service->repository->query('source_lines')->where('id', $input[$field])->exists(), 404);
        }
        abort_unless($service->repository->query('cards')->where('id', $input['cardId'])->exists() && $service->repository->query('accounts')->where('id', $input['accountId'])->exists(), 404);

        return response()->json((new HistoricalRefund($service))->post([...$input, 'key' => $key, 'recordedAt' => now()->toIso8601String()]));
    }
}
