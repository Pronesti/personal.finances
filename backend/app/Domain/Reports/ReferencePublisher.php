<?php

namespace App\Domain\Reports;

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Support\PrivateRoots;
use RuntimeException;

class ReferencePublisher
{
    public function publish(string $input, string $expected): array
    {
        if (! is_file($input) || is_link($input) || realpath($input) !== $input || filesize($input) > 8388608) {
            throw new RuntimeException('private_reference_input_required');
        }
        $bytes = file_get_contents($input);
        $tables = json_decode($bytes, true, flags: JSON_THROW_ON_ERROR);
        ReferenceTables::validate($tables);
        $root = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        $lock = fopen($root.'/.publication.lock', 'c');
        chmod($root.'/.publication.lock', 0600);
        if (! $lock || ! flock($lock, LOCK_EX)) {
            throw new RuntimeException('reference_publication_lock');
        }
        try {
            $empty = array_all(['current.json', 'ipc.json', 'mep.json'], fn ($file) => ! file_exists($root.'/'.$file) && ! is_link($root.'/'.$file));
            $oldFingerprint = $empty ? 'empty' : FinancialCommands::digest((new ReferenceTables)->read());
            if (! hash_equals($oldFingerprint, $expected)) {
                throw new RuntimeException('stale_reference_version');
            }
            $version = hash('sha256', LedgerRepository::json($tables));
            $directory = $root.'/release-'.$version;
            if (file_exists($directory)) {
                throw new RuntimeException('reference_release_exists');
            }mkdir($directory, 0700);
            foreach (['cpi' => 'ipc.json', 'mep' => 'mep.json'] as $name => $file) {
                $this->write($directory.'/'.$file, LedgerRepository::json($tables[$name])."\n");
            }
            $manifest = ['version' => $version, 'sourceSha256' => hash('sha256', $bytes), 'publishedAt' => gmdate('c'), 'files' => []];
            foreach (['ipc.json', 'mep.json'] as $file) {
                $manifest['files'][$file] = ['path' => 'release-'.$version.'/'.$file, 'sha256' => hash_file('sha256', $directory.'/'.$file)];
            }
            $temporary = $root.'/.publish-'.bin2hex(random_bytes(12));
            $this->write($temporary, LedgerRepository::json($manifest));
            if (! rename($temporary, $root.'/current.json')) {
                throw new RuntimeException('reference_publish_failed');
            }

            return ['version' => $version, 'sourceSha256' => $manifest['sourceSha256'], 'previousFingerprint' => $expected, 'fingerprint' => FinancialCommands::digest($tables)];
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function write(string $path, string $bytes): void
    {
        $file = fopen($path, 'xb');
        if (! $file) {
            throw new RuntimeException('reference_write_failed');
        }
        try {
            chmod($path, 0600);
            if (fwrite($file, $bytes) !== strlen($bytes) || ! fflush($file) || ! fsync($file)) {
                throw new RuntimeException('reference_write_failed');
            }
        } finally {
            fclose($file);
        }
    }
}
