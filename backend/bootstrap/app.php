<?php

use App\Http\Middleware\RequireApprovedTestTarget;
use App\Http\Middleware\ResolveLedger;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
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
            $codes = [401 => 'unauthenticated', 404 => 'not_found', 419 => 'csrf_mismatch', 429 => 'rate_limited'];
            if (isset($codes[$e->getStatusCode()])) {
                return response()->json(['error' => ['code' => $codes[$e->getStatusCode()], 'message_key' => 'errors.'.$codes[$e->getStatusCode()], 'params' => (object) []]], $e->getStatusCode(), $e->getHeaders());
            }
        });
    })->create();
