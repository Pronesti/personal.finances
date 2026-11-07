<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Catalog\CatalogSettings;
use App\Domain\Ledger\LedgerRepository;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CatalogController extends Controller
{
    private function settings(Request $request): CatalogSettings
    {
        return new CatalogSettings(new LedgerRepository($request->attributes->get('ledger'), $request->attributes->get('processing_budget')));
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->settings($request)->read());
    }

    private function command(Request $request): array
    {
        $key = $request->header('Idempotency-Key');
        validator(['key' => $key], ['key' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9._:-]+$/D']])->validate();

        return ['key' => $key, 'recordedAt' => now()->toIso8601String()];
    }

    public function rename(Request $request): JsonResponse
    {
        $input = $request->validate(['accountId' => ['required', 'string', 'max:200'], 'customName' => ['present', 'nullable', 'string', 'max:300'], 'expectedVersion' => ['required', 'integer', 'min:0']]);

        return response()->json($this->settings($request)->rename([...$input, ...$this->command($request)]));
    }

    public function group(Request $request): JsonResponse
    {
        $input = $request->validate(['groupId' => ['present', 'nullable', 'string', 'max:200'], 'customName' => ['present', 'nullable', 'string', 'max:300'], 'expectedVersion' => ['required', 'integer', 'min:0'], 'accountIds' => ['required', 'array', 'min:1', 'max:500'], 'accountIds.*' => ['required', 'string', 'max:200', 'distinct']]);

        return response()->json($this->settings($request)->saveGroup([...$input, ...$this->command($request)]));
    }
}
