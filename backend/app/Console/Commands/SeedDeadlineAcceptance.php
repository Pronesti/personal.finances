<?php

namespace App\Console\Commands;

use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class SeedDeadlineAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:deadline-cases {directory : New child of the approved integration temp root} {--audit}';

    protected $description = 'Guarded factory ownership for separate normal/FPM and isolated watchdog wire cases';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        if (config('tarjetas.test_target.id') !== 'integration') {
            throw new \RuntimeException('integration_deadline_target_required');
        }$root = $this->argument('directory');
        $parent = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root'));
        if (dirname($root) !== $parent || ! preg_match('/^dw-[a-f0-9]{4,12}$/D', basename($root))) {
            throw new \RuntimeException('deadline_private_output_required');
        }
        if ($this->option('audit')) {
            $items = json_decode(file_get_contents($root.'/cases.json'), true, flags: JSON_THROW_ON_ERROR);
            $rows = [];
            foreach ($items as $item) {
                $case = json_decode(file_get_contents($item), true, flags: JSON_THROW_ON_ERROR);
                $repository = new LedgerRepository(Ledger::query()->findOrFail($case['ledgerId']));
                $rows[] = ['name' => $case['fixture']['name'], 'mode' => $case['fixture']['mode'], 'journals' => $repository->query('journals')->count()];
            }$this->line(json_encode($rows, JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        }
        if (file_exists($root) || ! mkdir($root, 0700)) {
            throw new \RuntimeException('deadline_directory_exists');
        }$fixtures = json_decode(file_get_contents(base_path('../docs/rebuild/deadline-fixtures.json')), true, flags: JSON_THROW_ON_ERROR)['cases'];
        $names = ['buffered_upload_then_success', 'buffered_upload_then_processing_timeout', 'outer_watchdog_queue_timeout_fault_injection'];
        $items = [];
        foreach ($names as $index => $name) {
            $case = array_values(array_filter($fixtures, fn ($row) => $row['name'] === $name))[0];
            $directory = $root.'/'.$index;
            mkdir($directory, 0700);
            foreach (['contexts', 'uploads', 'tmp'] as $folder) {
                mkdir($directory.'/'.$folder, 0700);
            }$repository = new LedgerRepository(Ledger::factory()->create());
            app(CatalogBootstrap::class)->initialize($repository, [['id' => 'deadline-card', 'displayName' => 'Synthetic deadline card']]);
            $repository->transaction(fn () => $repository->insert('evidence', ['id' => 'synthetic:deadline-proof', 'kind' => 'synthetic', 'metadata' => '{}']));
            $file = $directory.'/case.json';
            $handle = fopen($file, 'xb');
            chmod($file, 0600);
            fwrite($handle, json_encode(['root' => $directory, 'ledgerId' => $repository->ledger->id, 'fixture' => $case], JSON_THROW_ON_ERROR));
            fclose($handle);
            $items[] = $file;
        }
        $handle = fopen($root.'/cases.json', 'xb');
        chmod($root.'/cases.json', 0600);
        fwrite($handle, json_encode($items, JSON_THROW_ON_ERROR));
        fclose($handle);
        $this->line(json_encode(['directory' => $root, 'cases' => count($items)], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
