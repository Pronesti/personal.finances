<?php

use App\Http\Controllers\Api\V1\AccountingController;
use App\Http\Controllers\Api\V1\BootstrapController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\ReceiptController;
use App\Http\Controllers\Api\V1\SessionController;
use App\Http\Controllers\Api\V1\SourceReviewController;
use App\Http\Controllers\Api\V1\StatementController;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

Route::get('health', fn () => response()->json([
    'status' => 'ok', 'service' => 'tarjetas-api', 'api_version' => 'v1',
]))->withoutMiddleware(EnsureFrontendRequestsAreStateful::class)->name('api.v1.health');

Route::middleware(['auth:sanctum', 'ledger'])->group(function (): void {
    Route::get('receipt-charges', [SourceReviewController::class, 'charges']);
    Route::post('receipts/{id}/historical-associations', [SourceReviewController::class, 'associate'])->whereNumber('id');
    Route::post('historical-refunds', [SourceReviewController::class, 'refund']);
    Route::get('statements', [StatementController::class, 'index']);
    Route::post('statements', [StatementController::class, 'store']);
    Route::get('receipts', [ReceiptController::class, 'index']);
    Route::get('receipts/{id}', [ReceiptController::class, 'show'])->whereNumber('id');
    Route::post('receipts', [ReceiptController::class, 'store']);
    Route::post('receipts/corrections', [ReceiptController::class, 'correction']);
    Route::post('receipts/corrections/{hash}', [ReceiptController::class, 'correct'])->where('hash', '[a-f0-9]{64}');
    Route::post('receipts/{id}/reconciliation', [ReceiptController::class, 'reconcile'])->whereNumber('id');
    Route::post('receipts/{id}/unlink', [ReceiptController::class, 'unlink'])->whereNumber('id');
    Route::post('product-reviews', [ReceiptController::class, 'review']);
    Route::get('accounting', [AccountingController::class, 'index'])->name('api.v1.accounting');
    Route::get('accounting/evidence/{id}', [AccountingController::class, 'evidence'])->name('api.v1.evidence');
    Route::get('bootstrap', BootstrapController::class)->name('api.v1.bootstrap');
    Route::get('documents/{hash}', DocumentController::class)->name('api.v1.documents.show');
    Route::get('auth/user', [SessionController::class, 'show'])->name('api.v1.auth.user');
});
