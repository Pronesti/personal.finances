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
        foreach ($this->files() as $name => $path) {
            if (is_link($path) || ! is_file($path) || filesize($path) > 4194304) {
                throw new AccountingError('references_unavailable');
            }
            try {
                $tables[$name] = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                throw new AccountingError('references_unavailable');
            }
        }
        self::validate($tables);

        return $tables;
    }

    /** Pin one immutable release so concurrent publication cannot mix the two tables. */
    public function files(): array
    {
        $root = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        if (! file_exists($root.'/current.json')) {
            return ['cpi' => $root.'/ipc.json', 'mep' => $root.'/mep.json'];
        }
        if (is_link($root.'/current.json') || filesize($root.'/current.json') > 4096) {
            throw new AccountingError('references_unavailable');
        }
        try {
            $manifest = json_decode(file_get_contents($root.'/current.json'), true, flags: JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            throw new AccountingError('references_unavailable');
        }
        if (! is_string($manifest['version'] ?? null) || ! preg_match('/^[a-f0-9]{64}$/D', $manifest['version'])) {
            throw new AccountingError('references_unavailable');
        }
        $files = [];
        foreach (['cpi' => 'ipc.json', 'mep' => 'mep.json'] as $name => $file) {
            $relative = 'release-'.$manifest['version'].'/'.$file;
            $entry = $manifest['files'][$file] ?? null;
            $path = $root.'/'.$relative;
            if (! is_array($entry) || ($entry['path'] ?? null) !== $relative || ! is_file($path) || is_link($path) || realpath($path) !== $path || filesize($path) > 4194304 || ! hash_equals(hash_file('sha256', $path), (string) ($entry['sha256'] ?? ''))) {
                throw new AccountingError('references_unavailable');
            }
            $files[$name] = $path;
        }

        return $files;
    }

    /** Preserve the frozen at-or-before lookup; later periods remain visibly stale. */
    public static function assertCoverage(array $tables, array $months): void
    {
        $months = array_values(array_unique($months));
        sort($months, SORT_STRING);
        $first = $months[0] ?? null;
        if ($first === null) {
            return;
        }
        foreach (['cpi', 'mep'] as $name) {
            $observations = array_keys($tables[$name]);
            sort($observations, SORT_STRING);
            $latest = end($observations);
            if ($latest < $first || ($name === 'cpi' && count($observations) < 2)) {
                throw new AccountingError('references_too_old', ['requiredMonth' => $first, 'table' => $name, 'latestMonth' => $latest]);
            }
            if ($observations[0] > $first) {
                throw new AccountingError('references_unavailable', ['table' => $name, 'missingMonth' => $first]);
            }
        }
    }

    public static function metadata(array $tables, array $months): array
    {
        $cpi = array_key_last($tables['cpi']);
        $mep = array_key_last($tables['mep']);

        return ['available' => true, 'cpiLatestMonth' => $cpi, 'mepLatestMonth' => $mep, 'mepLatestRate' => $tables['mep'][$mep], 'stale' => ($months === [] ? '' : max($months)) > min($cpi, $mep)];
    }

    public static function validate(mixed &$tables): void
    {
        if (! is_array($tables) || array_diff(array_keys($tables), ['cpi', 'mep']) !== []) {
            throw new AccountingError('invalid_report_rate');
        }
        foreach (['cpi', 'mep'] as $name) {
            if (! isset($tables[$name]) || ! is_array($tables[$name]) || $tables[$name] === []) {
                throw new AccountingError('references_unavailable');
            }
            foreach ($tables[$name] as $month => $value) {
                if (! preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', (string) $month) || (! is_int($value) && ! is_float($value)) || ! is_finite((float) $value) || $value <= 0) {
                    throw new AccountingError('invalid_report_rate');
                }
            }
            ksort($tables[$name], SORT_STRING);
        }
    }
}
