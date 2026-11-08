<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Recovery\OwnedRecovery;
use App\Http\Controllers\Controller;
use App\Support\PrivateRoots;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class LedgerExportController extends Controller
{
    public function show(Request $request, OwnedRecovery $recovery): BinaryFileResponse
    {
        $root = PrivateRoots::canonical((string) (config('tarjetas.processing_temp_root') ?? config('tarjetas.test_target.temp_root')));
        $path = $root.'/ledger-export-'.Str::uuid().'.zip';
        $recovery->export($request->attributes->get('ledger'), $path, $request->attributes->get('processing_budget'));

        return response()->download($path, 'tarjetas-financial-export.zip', ['Content-Type' => 'application/zip', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff'])->deleteFileAfterSend(true);
    }
}
