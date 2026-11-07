<?php

namespace App\Domain\Processing;

use App\Domain\Ledger\AccountingError;
use App\Support\PrivateRoots;
use Illuminate\Support\Str;

/** Stages only this request's PDF in a private, non-shared directory. */
class PrivateUpload
{
    public function withPdf(string $bytes, callable $work): mixed
    {
        if (strlen($bytes) > 41943040) {
            throw new AccountingError('too_large');
        }
        if (! str_starts_with($bytes, '%PDF-')) {
            throw new AccountingError('not_pdf');
        }
        $root = PrivateRoots::canonical((string) (config('tarjetas.processing_temp_root') ?: config('tarjetas.test_target.temp_root')));
        $directory = $root.'/upload-'.Str::uuid();
        if (! mkdir($directory, 0700)) {
            throw new AccountingError('private_storage_unavailable');
        }
        $path = $directory.'/document.pdf';
        try {
            $stream = fopen($path, 'xb');
            if ($stream === false) {
                throw new AccountingError('private_storage_unavailable');
            }
            try {
                chmod($path, 0600);
                $offset = 0;
                while ($offset < strlen($bytes)) {
                    $written = fwrite($stream, substr($bytes, $offset));
                    if (! $written) {
                        throw new AccountingError('private_storage_unavailable');
                    }
                    $offset += $written;
                }
                if (! fflush($stream)) {
                    throw new AccountingError('private_storage_unavailable');
                }
            } finally {
                fclose($stream);
            }

            return $work($path);
        } finally {
            if (is_file($path)) {
                unlink($path);
            }
            rmdir($directory);
        }
    }
}
