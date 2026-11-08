<?php

namespace App\Console\Commands;

use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;

class SeedReferenceAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:references';

    protected $description = 'Publish frozen synthetic analytical references only into an approved disposable reference root';

    public function handle(TestTargetGuard $guard): int
    {
        $guard->check();
        $root = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        $tables = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true);
        foreach (['cpi' => 'ipc.json', 'mep' => 'mep.json'] as $name => $file) {
            $target = $root.'/'.$file;
            $bytes = json_encode($tables[$name], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n";
            if (file_exists($target)) {
                if (is_link($target) || file_get_contents($target) !== $bytes) {
                    throw new \RuntimeException('existing_reference_differs_refused');
                }

continue;
            }
            $temporary = $root.'/.synthetic-'.bin2hex(random_bytes(12));
            $handle = fopen($temporary, 'xb');
            try {
                chmod($temporary, 0600);
                if (fwrite($handle, $bytes) !== strlen($bytes) || ! fflush($handle) || ! fsync($handle)) {
                    throw new \RuntimeException('reference_write_failed');
                }
            } finally {
                fclose($handle);
            }
            try {
                if (! link($temporary, $target)) {
                    throw new \RuntimeException('reference_publish_failed');
                }
            } finally {
                unlink($temporary);
            }
        }
        $this->info('Frozen synthetic references verified/published on approved disposable target.');

        return self::SUCCESS;
    }
}
