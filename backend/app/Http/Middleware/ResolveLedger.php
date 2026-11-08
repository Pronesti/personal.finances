<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveLedger
{
    public function handle(Request $request, Closure $next): Response
    {
        $ledger = $request->user()->ledger;
        if ($ledger === null) {
            return response()->json(['error' => ['code' => 'ledger_setup_required', 'message_key' => 'errors.ledger_setup_required', 'params' => (object) []]], 409);
        }
        foreach (['ledger_id' => $ledger->id, 'user_id' => $request->user()->id, 'owner_user_id' => $request->user()->id] as $key => $expected) {
            foreach ([$request->query(), $request->post(), $request->json()->all()] as $input) {
                if (array_key_exists($key, $input) && (string) $input[$key] !== (string) $expected) {
                    return response()->json(['error' => ['code' => 'owner_scope_conflict', 'message_key' => 'errors.owner_scope_conflict', 'params' => (object) []]], 400);
                }
            }
            if ($request->headers->has($key) || $request->headers->has(str_replace('_', '-', $key))) {
                return response()->json(['error' => ['code' => 'owner_scope_conflict', 'message_key' => 'errors.owner_scope_conflict', 'params' => (object) []]], 400);
            }
        }
        $request->attributes->set('ledger', $ledger);
        $response = $next($request);
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }
}
