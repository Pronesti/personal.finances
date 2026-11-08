<?php

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Domain\Processing\PrivateProcess;
use App\Domain\Processing\ProcessingBudget;
use App\Http\Middleware\VerifyPrivateIngress;
use App\Models\Ledger;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;

// Isolated FPM test script, outside public/. No application route selects this harness.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->make(TestTargetGuard::class)->check();
if (! $app->environment('testing') || config('tarjetas.test_target.id') !== 'integration') {
    throw new RuntimeException('isolated_normal_deadline_harness_required');
}
$filename = getenv('TARJETAS_DEADLINE_CASE');
if (! is_string($filename) || realpath($filename) !== $filename || is_link($filename) || (fileperms($filename) & 0077) !== 0) {
    throw new RuntimeException('private_deadline_case_required');
}
$settings = json_decode(file_get_contents($filename), true, flags: JSON_THROW_ON_ERROR);
PrivateRoots::canonical($settings['root']);
if ($settings['fixture']['mode'] !== 'normal') {
    throw new RuntimeException('fault_mode_is_not_a_backend_option');
}
$request = Request::capture();
try {
    $response = $app->make(VerifyPrivateIngress::class)->handle($request, function ($request) use ($settings) {
        $budget = ProcessingBudget::fromIngress($request);
        $start = $request->server->get('TARJETAS_INGRESS_STARTED_AT_UNIX_MS');
        $deadline = $request->server->get('TARJETAS_INGRESS_DEADLINE_UNIX_MS');
        $entry = ['originalStart' => (int) $start, 'originalDeadline' => (int) $deadline, 'backendEntry' => (int) floor(microtime(true) * 1000), 'sapi' => PHP_SAPI];
        file_put_contents($settings['root'].'/backend.json', json_encode($entry, JSON_THROW_ON_ERROR), LOCK_EX);
        chmod($settings['root'].'/backend.json', 0600);
        app(PrivateProcess::class)->json([config('tarjetas.python'), __DIR__.'/deadline-worker.py', $settings['root'].'/worker.json'], json_encode(['originalStart' => (int) $start, 'originalDeadline' => (int) $deadline, 'phases' => $settings['fixture']['processing_phases'], 'cleanup_ms' => $settings['fixture']['cleanup_ms']], JSON_THROW_ON_ERROR), $budget, true);
        $repository = new LedgerRepository(Ledger::query()->findOrFail($settings['ledgerId']), $budget);
        $budget->assertNonOcr();
        $result = (new FinancialCommands($repository))->purchase(['key' => 'synthetic:deadline-command', 'purchaseId' => 'purchase:deadline', 'cardId' => 'deadline-card', 'currency' => 'ARS', 'effectiveDate' => '2026-01-15', 'recordedAt' => now()->toIso8601String(), 'evidenceIds' => ['synthetic:deadline-proof'], 'principalMinor' => 10500, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 10500]]]);

        return response()->json(['status' => 'ok', 'posting' => $result, 'entry' => $entry, 'finished' => (int) floor(microtime(true) * 1000)]);
    });
} catch (Throwable $error) {
    $response = $app->make(ExceptionHandler::class)->render($request, $error);
}
$response->send();
