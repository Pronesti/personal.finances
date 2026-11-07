<?php

namespace App\Domain\Evidence;

use App\Models\Ledger;
use App\Support\PrivateRoots;
use Illuminate\Support\Str;
use RuntimeException;

class DocumentStore
{
    private function path(Ledger $ledger, string $hash, ?string $pending = null): string
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $hash) || ! Str::isUuid($ledger->id) || ($pending !== null && ! preg_match('/^[A-Za-z0-9_-]+$/D', $pending))) {
            throw new RuntimeException('invalid_object_identity');
        }
        $root = PrivateRoots::canonical((string) config('tarjetas.document_root'));
        PrivateRoots::assertDisjoint([$root, (string) config('tarjetas.reference_root')], []);
        $relative = 'ledgers/'.$ledger->id.'/'.($pending === null ? 'objects/' : 'pending/'.$pending.'/').$hash;
        $current = $root;
        foreach (explode('/', $relative) as $part) {
            $current .= '/'.$part;
            if (is_link($current)) {
                throw new RuntimeException('unsafe_object_path');
            }
        }

        return $current;
    }

    public function put(Ledger $ledger, string $bytes, ?string $pending = null): array
    {
        $hash = hash('sha256', $bytes);
        $path = $this->path($ledger, $hash, $pending);
        $directory = dirname($path);
        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            throw new RuntimeException('object_write_failed');
        }
        $root = config('tarjetas.document_root');
        for ($dir = $directory; $dir !== $root; $dir = dirname($dir)) {
            if (is_link($dir) || realpath($dir) !== $dir || (fileperms($dir) & 0077) !== 0) {
                throw new RuntimeException('unsafe_object_directory');
            }
        }
        if (! file_exists($path)) {
            $temporary = $directory.'/.object-'.bin2hex(random_bytes(16));
            $handle = fopen($temporary, 'x+b');
            if ($handle === false) {
                throw new RuntimeException('object_write_failed');
            }
            try {
                chmod($temporary, 0600);
                $offset = 0;
                while ($offset < strlen($bytes)) {
                    $written = fwrite($handle, substr($bytes, $offset));
                    if ($written === false || $written === 0) {
                        throw new RuntimeException('object_write_failed');
                    }
                    $offset += $written;
                }
                if (! fflush($handle) || ! fsync($handle)) {
                    throw new RuntimeException('object_write_failed');
                }
                fclose($handle);
                $handle = null;
                if (! @link($temporary, $path) && ! file_exists($path)) {
                    throw new RuntimeException('object_publish_failed');
                }
            } finally {
                if (is_resource($handle)) {
                    fclose($handle);
                }
                unlink($temporary);
            }
        }
        $this->read($ledger, $hash, strlen($bytes), $pending);

        return ['sha256' => $hash, 'byte_length' => strlen($bytes), 'relative_path' => substr($path, strlen($root) + 1)];
    }

    public function read(Ledger $ledger, string $hash, int $size, ?string $pending = null): string
    {
        $path = $this->path($ledger, $hash, $pending);
        if (! is_file($path) || (fileperms($path) & 0077) !== 0 || filesize($path) !== $size) {
            throw new RuntimeException('object_integrity_failed');
        }
        $bytes = file_get_contents($path);
        if ($bytes === false || ! hash_equals($hash, hash('sha256', $bytes))) {
            throw new RuntimeException('object_integrity_failed');
        }

        return $bytes;
    }
}
