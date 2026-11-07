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
            'cards' => DB::table('accounting.cards')->where('ledger_id', $ledger->id)->orderBy('id')->get(['id'])->map(fn ($card) => ['id' => $card->id, 'display_name' => DB::table('accounting.accounts')->where('ledger_id', $ledger->id)->where('id', 'card:'.$card->id)->value('custom_name') ?? $card->id]),
            'catalog' => DB::table('accounting.accounts')->where('ledger_id', $ledger->id)->orderBy('id')->get(['id', 'parent_id', 'type', 'posting', 'enabled', 'label_key', 'custom_name', 'primary_purpose_id', 'currency']),
            'months' => [],
            'documents' => DB::table('accounting.object_references')->where('ledger_id', $ledger->id)->where('kind', 'object')->orderBy('reference_id')->get(['reference_id', 'sha256', 'byte_length']),
        ]);
    }
}
