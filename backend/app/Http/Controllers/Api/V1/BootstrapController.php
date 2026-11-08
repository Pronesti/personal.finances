<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reports\ReferenceTables;
use App\Domain\Reports\ReportSnapshot;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BootstrapController extends Controller
{
    public function __invoke(Request $request, ReferenceTables $tables): JsonResponse
    {
        $repository = new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget'));

        return response()->json($repository->readSnapshot(function () use ($repository, $tables) {
            $snapshot = (new ReportSnapshot($repository))->read();
            try {
                $rates = $tables->read();
                $references = ReferenceTables::metadata($rates, $snapshot['months']);
                ReferenceTables::assertCoverage($rates, $snapshot['months']);
            } catch (AccountingError $error) {
                $references = [...($references ?? []), 'available' => false, 'code' => $error->errorCode];
            }

            return [
                'cards' => array_map(fn ($card) => ['id' => $card['id'], 'display_name' => $card['displayName']], $snapshot['cards']),
                'catalog' => $repository->query('accounts')->orderBy('id')->get(['id', 'parent_id', 'type', 'posting', 'enabled', 'label_key', 'custom_name', 'primary_purpose_id', 'currency']),
                'months' => $snapshot['months'],
                'references' => $references,
                'documents' => $repository->query('object_references')->where('kind', 'object')->orderBy('reference_id')->get(['reference_id', 'sha256', 'byte_length']),
            ];
        }));
    }
}
