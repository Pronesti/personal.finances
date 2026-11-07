<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Evidence\StatementImporter;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\PrivateUpload;
use App\Domain\Processing\ProcessingBudget;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StatementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $input = $request->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:50']]);
        $repository = new LedgerRepository($request->attributes->get('ledger'));

        return response()->json($repository->readSnapshot(function () use ($repository, $input) {
            $size = (int) ($input['per_page'] ?? 20);
            $page = (int) ($input['page'] ?? 1);
            $query = $repository->query('source_revisions')->where('kind', 'statement');
            $total = (clone $query)->count();
            $rows = $query->orderByDesc('ordinal')->offset(($page - 1) * $size)->limit($size)->get()->map(function ($row) use ($repository) {
                $source = json_decode($row->payload, true);

                return ['id' => $row->id, 'cardId' => $row->card_id, 'documentHash' => $row->document_hash, 'admission' => $source['admission'], 'filename' => $source['rawPayload']['file'], 'closingDate' => $source['rawPayload']['period']['closing_date'], 'recordedAt' => $source['recordedAt'], 'previousRevisionId' => $source['previousRevisionId'], 'reviews' => $repository->query('review_events')->where('subject_id', $row->id)->orderBy('ordinal')->get()->map(fn ($event) => ['id' => $event->id, 'code' => $event->code, 'state' => $event->state, 'previousDecisionId' => $event->prior_decision_id, 'sourceLineIds' => json_decode($event->source_line_ids, true), 'params' => json_decode($event->params, true)])];
            });

            return ['data' => $rows, 'meta' => ['page' => $page, 'per_page' => $size, 'total' => $total]];
        }));
    }

    public function store(Request $request, PrivateUpload $uploads, PrivateProcess $process, DocumentStore $documents): JsonResponse
    {
        $input = $request->validate(['cardId' => ['required', 'string', 'max:200']]);
        $file = PrivateUpload::validatedFile($request, 10485760);
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();
        $budget = ProcessingBudget::fromIngress($request);
        $repository = new LedgerRepository($request->attributes->get('ledger'), $budget);
        abort_unless($repository->query('cards')->where('id', $input['cardId'])->exists(), 404);
        $bytes = $file->get();
        $filename = $file->getClientOriginalName();
        $raw = $uploads->withPdf($bytes, fn ($path) => $process->json([config('tarjetas.python'), base_path('processing/statement.py'), $path], '', $budget), $filename);

        return response()->json((new StatementImporter($repository, $documents))->import(['key' => $key, 'cardId' => $input['cardId'], 'filename' => $filename, 'pdf' => $bytes, 'rawJson' => LedgerRepository::json($raw), 'recordedAt' => now()->toIso8601String(), 'appRevision' => config('tarjetas.revision')]));
    }
}
