<?php

use App\Http\Controllers\Api\V1\AccountingController;
use App\Http\Controllers\Api\V1\BootstrapController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\SessionController;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

Route::get('health', fn () => response()->json([
    'status' => 'ok', 'service' => 'tarjetas-api', 'api_version' => 'v1',
]))->withoutMiddleware(EnsureFrontendRequestsAreStateful::class)->name('api.v1.health');

Route::middleware(['auth:sanctum', 'ledger'])->group(function (): void {
    Route::get('accounting', [AccountingController::class, 'index'])->name('api.v1.accounting');
    Route::get('accounting/evidence/{id}', [AccountingController::class, 'evidence'])->name('api.v1.evidence');
    Route::get('bootstrap', BootstrapController::class)->name('api.v1.bootstrap');
    Route::get('documents/{hash}', DocumentController::class)->name('api.v1.documents.show');
    Route::get('auth/user', [SessionController::class, 'show'])->name('api.v1.auth.user');
});
