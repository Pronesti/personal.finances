<?php

use App\Domain\Evidence\ReceiptRejected;
use App\Domain\Ledger\AccountingError;
use App\Http\Middleware\RequireApprovedTestTarget;
use App\Http\Middleware\ResolveLedger;
use App\Http\Middleware\VerifyPrivateIngress;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: 'api/v1',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->append(RequireApprovedTestTarget::class);
        $middleware->append(VerifyPrivateIngress::class);
        $middleware->statefulApi();
        $middleware->preventRequestForgery(originOnly: false, allowSameSite: false);
        $middleware->alias(['ledger' => ResolveLedger::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);
        $exceptions->render(function (AuthenticationException $exception) {
            return response()->json(['error' => ['code' => 'unauthenticated', 'message_key' => 'errors.unauthenticated', 'params' => (object) []]], 401);
        });
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            $codes = [401 => 'unauthenticated', 404 => 'not_found', 413 => 'too_large', 419 => 'csrf_mismatch', 429 => 'rate_limited'];
            if (isset($codes[$e->getStatusCode()])) {
                return response()->json(['error' => ['code' => $codes[$e->getStatusCode()], 'message_key' => 'errors.'.$codes[$e->getStatusCode()], 'params' => (object) []]], $e->getStatusCode(), $e->getHeaders());
            }
        });
        $exceptions->render(function (ReceiptRejected $exception) {
            return response()->json(['error' => ['code' => 'verification_failed', 'message_key' => 'errors.verification_failed', 'params' => (object) []], ...$exception->receiptPayload], 422);
        });
        $exceptions->render(function (AccountingError $exception) {
            $status = match ($exception->errorCode) {
                'proposals_unavailable', 'proposal_service_failed', 'deadline_metadata_invalid', 'python_missing', 'ocr_unavailable', 'references_unavailable', 'references_too_old' => 503,
                'processing_timeout', 'non_ocr_budget_exceeded', 'ocr_attempt_timeout' => 504,
                'command_conflict', 'stale_purchase_version', 'stale_review_version', 'stale_receipt_link', 'stale_historical_association', 'stale_catalog_version' => 409,
                'verification_failed' => 422,
                default => 400,
            };

            return response()->json(['error' => ['code' => $exception->errorCode, 'message_key' => 'errors.'.$exception->errorCode, 'params' => (object) $exception->parameters]], $status);
        });
        $exceptions->render(function (QueryException $exception) {
            return response()->json(['error' => ['code' => 'database_unavailable', 'message_key' => 'errors.database_unavailable', 'params' => (object) []]], 503);
        });
        $exceptions->render(function (Throwable $exception) {
            if ($exception instanceof ValidationException) {
                return null;
            }
            $status = $exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500;

            return response()->json(['error' => ['code' => 'server_error', 'message_key' => 'errors.server_error', 'params' => (object) []]], $status);
        });
    })->create();
