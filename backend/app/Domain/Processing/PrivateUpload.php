<?php

namespace App\Domain\Processing;

use App\Domain\Ledger\AccountingError;
use App\Support\PrivateRoots;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/** Stages only this request's PDF in a private, non-shared directory. */
class PrivateUpload
{
    public static function validatedFile(Request $request, int $limit): UploadedFile
    {
        $files = $request->allFiles();
        if (count($files) > 1 || ($files !== [] && (array_keys($files) !== ['file'] || is_array($files['file'])))) {
            throw new AccountingError('invalid_upload_envelope');
        }
        $fields = $request->request->all();
        if (count($fields) > 32 || array_any($fields, fn ($value) => ! is_scalar($value) && $value !== null)) {
            throw new AccountingError('invalid_upload_envelope');
        }
        $fieldBytes = array_sum(array_map(fn ($value) => strlen((string) $value), $fields));
        if ($fieldBytes > 1048576) {
            abort(413);
        }
        $file = $request->file('file');
        if ($file instanceof UploadedFile && in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new AccountingError('too_large');
        }
        $request->validate(['file' => ['required', 'file']]);
        if ($file->getSize() > $limit) {
            throw new AccountingError('too_large');
        }
        $length = $request->server->get('CONTENT_LENGTH');
        if (is_string($length) && ctype_digit($length) && (int) $length - $file->getSize() > 1048576) {
            abort(413);
        }

        return $file;
    }

    public function withPdf(string $bytes, callable $work, string $filename = 'document.pdf'): mixed
    {
        if (strlen($filename) > 200 || ! preg_match('/^[A-Za-z0-9][A-Za-z0-9._ -]*\.pdf$/iD', $filename)) {
            throw new AccountingError('bad_name');
        }
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
        $path = $directory.'/'.$filename;
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
