<?php

use App\Http\Controllers\Api\V1\SessionController;
use Illuminate\Support\Facades\Route;

Route::prefix('api/v1/auth')->group(function (): void {
    Route::post('login', [SessionController::class, 'login'])->middleware('throttle:login')->name('api.v1.auth.login');
    Route::post('logout', [SessionController::class, 'logout'])->middleware('auth:sanctum')->name('api.v1.auth.logout');
});
