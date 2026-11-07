<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BootstrapController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $ledger = $request->attributes->get('ledger');

        return response()->json([
            'cards' => [], 'catalog' => [], 'months' => [],
            'documents' => DB::table('accounting.object_references')->where('ledger_id', $ledger->id)->where('kind', 'object')->orderBy('reference_id')->get(['reference_id', 'sha256', 'byte_length']),
        ]);
    }
}
