<?php

namespace App\Domain\Reports;

use App\Domain\Ledger\AccountingError;
use App\Support\PrivateRoots;

class ReferenceTables
{
    public function read(): array
    {
        try {
            $root = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        } catch (\Throwable) {
            throw new AccountingError('references_unavailable');
        }
        $tables = [];
        foreach (['cpi' => 'ipc.json', 'mep' => 'mep.json'] as $name => $file) {
            $path = $root.'/'.$file;
            if (is_link($path) || ! is_file($path) || filesize($path) > 4194304) {
                throw new AccountingError('references_unavailable');
            }
            try {
                $table = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                throw new AccountingError('references_unavailable');
            }
            if (! is_array($table) || $table === []) {
                throw new AccountingError('references_unavailable');
            }
            foreach ($table as $month => $value) {
                if (! preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', (string) $month) || (! is_int($value) && ! is_float($value)) || ! is_finite((float) $value) || $value <= 0) {
                    throw new AccountingError('invalid_report_rate');
                }
            }
            ksort($table, SORT_STRING);
            $tables[$name] = $table;
        }

        return $tables;
    }
}
