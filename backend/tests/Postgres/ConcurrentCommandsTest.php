<?php

namespace Tests\Postgres;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Symfony\Component\Process\Process;
use Tests\PostgresTestCase;

class ConcurrentCommandsTest extends PostgresTestCase
{
    private function race(Ledger $ledger, string $action, array $inputs): array
    {
        $processes = [];
        foreach ($inputs as $input) {
            $process = new Process(['php', 'tests/Support/command-worker.php'], base_path(), ['APP_ENV' => 'testing']);
            $process->setInput(json_encode(['ledger' => $ledger->id, 'action' => $action, 'input' => $input], JSON_THROW_ON_ERROR));
            $process->setTimeout(15);
            $process->start();
            $processes[] = $process;
        }
        $results = [];
        foreach ($processes as $process) {
            $process->wait();
            $this->assertTrue($process->isSuccessful(), $process->getErrorOutput());
            $results[] = json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
        }

        return $results;
    }

    public function test_real_concurrent_identical_commands_and_competing_corrections_serialize_per_ledger(): void
    {
        $ledger = Ledger::factory()->create();
        $repository = new LedgerRepository($ledger);
        app(CatalogBootstrap::class)->initialize($repository, [['id' => 'synthetic-visa-a', 'displayName' => 'Synthetic Visa A']]);
        $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:e1', 'kind' => 'synthetic', 'metadata' => '{}']));
        $input = ['key' => 'concurrent:purchase', 'purchaseId' => 'purchase:shared', 'cardId' => 'synthetic-visa-a', 'currency' => 'ARS', 'effectiveDate' => '2026-01-15', 'recordedAt' => '2026-01-15T12:00:00Z', 'evidenceIds' => ['synthetic:e1'], 'principalMinor' => 100, 'allocations' => [['accountId' => 'expense:unallocated', 'purposeId' => 'unallocated', 'minor' => 100]]];
        $results = $this->race($ledger, 'purchase', [$input, $input]);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame(['duplicate', 'posted'], $statuses);
        $this->assertSame($results[0]['journalIds'], $results[1]['journalIds']);
        $this->assertSame(1, $repository->query('journals')->count());
        $correction = ['key' => 'correction:a', 'cardId' => $input['cardId'], 'purchaseId' => $input['purchaseId'], 'expectedVersion' => 1, 'replacement' => [...$input, 'allocations' => [['accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'minor' => 100]]], 'recordedAt' => '2026-05-01T12:00:00Z', 'reason' => 'Synthetic concurrent correction'];
        $results = $this->race($ledger, 'correct', [$correction, [...$correction, 'key' => 'correction:b']]);
        $this->assertCount(1, array_filter($results, fn ($result) => ($result['status'] ?? null) === 'posted'));
        $this->assertCount(1, array_filter($results, fn ($result) => ($result['error'] ?? null) === 'stale_purchase_version'));
        $this->assertSame(3, $repository->query('journals')->count());
        $this->assertSame(2, $repository->purchase($input['purchaseId'])['version']);
    }
}
