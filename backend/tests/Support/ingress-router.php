<?php

use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\ProcessingBudget;
use App\Http\Middleware\VerifyPrivateIngress;
use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;

// Deliberately separate test server. This file is never a Laravel application route.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->make(TestTargetGuard::class)->check();
if (! $app->environment('testing')) {
    throw new RuntimeException('isolated_harness_required');
}
$request = Request::capture();
try {
    $response = $app->make(VerifyPrivateIngress::class)->handle($request, function ($request) {
        $budget = ProcessingBudget::fromIngress($request);
        if ($request->path() === 'process') {
            $marker = config('tarjetas.ingress_root').'/worker-'.$request->server->get('TARJETAS_INGRESS_REQUEST_ID').'.json';
            $program = 'import os,sys,json,time,subprocess; child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); open(sys.argv[1],"w").write(json.dumps([os.getpid(),child.pid])); child.wait(); print("{}")';
            $appResult = app(PrivateProcess::class)->json([config('tarjetas.python'), '-c', $program, $marker], '', $budget);
        }

        return response()->json(['requestId' => $request->server->get('TARJETAS_INGRESS_REQUEST_ID'), 'startedAt' => $request->server->get('TARJETAS_INGRESS_STARTED_AT_UNIX_MS'), 'now' => (int) floor(microtime(true) * 1000)]);
    });
} catch (Throwable $error) {
    $response = $app->make(ExceptionHandler::class)->render($request, $error);
}
$response->send();
