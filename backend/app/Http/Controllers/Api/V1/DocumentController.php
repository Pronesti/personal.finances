<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\DocumentStore;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class DocumentController extends Controller
{
    public function __invoke(Request $request, string $hash, DocumentStore $store): Response
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $hash)) {
            return response()->json(['error' => ['code' => 'invalid_hash', 'message_key' => 'errors.invalid_hash', 'params' => (object) []]], 400);
        }
        $ledger = $request->attributes->get('ledger');
        $reference = DB::table('accounting.object_references')->where('ledger_id', $ledger->id)->where('kind', 'object')->where('sha256', $hash)->first();
        abort_if($reference === null, 404);
        $bytes = $store->read($ledger, $hash, (int) $reference->byte_length);
        $pdf = str_starts_with($bytes, '%PDF-');

        return response($bytes, 200, [
            'Content-Type' => $pdf ? 'application/pdf' : 'application/octet-stream',
            'Content-Disposition' => ($pdf ? 'inline' : 'attachment').'; filename="'.$hash.($pdf ? '.pdf' : '.bin').'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
