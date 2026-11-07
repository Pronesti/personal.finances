<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

class SessionController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate(['email' => ['required', 'email', 'max:254'], 'password' => ['required', 'string', 'max:1024']]);
        if (! Auth::attempt($credentials, false)) {
            return response()->json(['error' => ['code' => 'invalid_credentials', 'message_key' => 'errors.invalid_credentials', 'params' => (object) []]], 422);
        }
        $request->session()->regenerate();
        if ($request->user()->ledger === null) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['error' => ['code' => 'ledger_setup_required', 'message_key' => 'errors.ledger_setup_required', 'params' => (object) []]], 409);
        }

        return $this->show($request);
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json(['user' => ['id' => $request->user()->id, 'name' => $request->user()->name, 'email' => $request->user()->email], 'ledger' => ['id' => $request->user()->ledger->id]])->header('Cache-Control', 'private, no-store');
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent()->header('Cache-Control', 'private, no-store');
    }
}
