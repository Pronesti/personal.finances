<?php

namespace App\Http\Middleware;

use App\Domain\Ledger\AccountingError;
use App\Domain\Processing\ProcessingBudget;
use App\Support\PrivateRoots;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/** Authenticates a loopback-only ingress hop; public headers never become server metadata. */
class VerifyPrivateIngress
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->headers->has('X-Tarjetas-Deadline')) {
            return $next($request);
        }
        $stamp = $request->header('X-Tarjetas-Deadline');
        $signature = $request->header('X-Tarjetas-Signature');
        $key = config('tarjetas.ingress_key');
        if (! in_array($request->server->get('REMOTE_ADDR'), ['127.0.0.1', '::1'], true) || ! is_string($key) || strlen($key) < 64 || ! is_string($signature) || ! hash_equals(hash_hmac('sha256', $request->method()."\n".$request->getRequestUri()."\n".$stamp, $key), $signature)) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        $data = json_decode($stamp, true);
        if (! is_array($data) || ! Str::isUuid($data['id'] ?? '') || ! is_int($data['start'] ?? null) || ($data['deadline'] ?? null) !== $data['start'] + 720000) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        $root = PrivateRoots::canonical((string) config('tarjetas.ingress_root'));
        $context = $root.'/'.$data['id'];
        if (is_link($context) || realpath($context) !== $context || ! is_dir($context) || (fileperms($context) & 0077) !== 0 || ! is_file($context.'/origin.json') || is_link($context.'/origin.json') || file_get_contents($context.'/origin.json') !== $stamp || is_file($context.'/backend.done')) {
            throw new AccountingError('deadline_metadata_invalid');
        }
        foreach (['REQUEST_ID' => $data['id'], 'STARTED_AT_UNIX_MS' => (string) $data['start'], 'DEADLINE_UNIX_MS' => (string) $data['deadline'], 'CLOCK_SKEW_MS' => '0', 'CONTEXT' => $context] as $name => $value) {
            $request->server->set('TARJETAS_INGRESS_'.$name, $value);
        }
        try {
            $budget = ProcessingBudget::fromIngress($request);
            $response = $next($request);
            $budget->check();

            return $response;
        } finally {
            file_put_contents($context.'/backend.done', 'done', LOCK_EX);
            chmod($context.'/backend.done', 0600);
        }
    }
}
