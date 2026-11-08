<?php

namespace App\Http\Middleware;

use App\Support\TestTargetGuard;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireApprovedTestTarget
{
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array(config('app.env'), ['testing', 'browser-testing'], true) && ! $request->is('api/v1/health')) {
            app(TestTargetGuard::class)->check();
        }

        return $next($request);
    }
}
