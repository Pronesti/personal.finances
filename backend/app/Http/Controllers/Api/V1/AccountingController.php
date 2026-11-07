<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ledger\LedgerReader;
use App\Domain\Ledger\LedgerRepository;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccountingController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $input = $request->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:50']]);
        $reader = new LedgerReader(new LedgerRepository($request->attributes->get('ledger')));

        return response()->json($reader->inspection((int) ($input['page'] ?? 1), (int) ($input['per_page'] ?? 20)));
    }

    public function evidence(Request $request, string $id): JsonResponse
    {
        $reader = new LedgerReader(new LedgerRepository($request->attributes->get('ledger')));
        $detail = $reader->evidence($id);
        abort_if($detail === null, 404);

        return response()->json($detail);
    }
}
