<?php

namespace App\Domain\Processing;

use App\Domain\Evidence\ReceiptVerification;
use App\Domain\Ledger\AccountingError;
use App\Support\PrivateRoots;

class ReceiptExtraction
{
    public function rows(string $text, ProcessingBudget $budget): array
    {
        if (strlen($text) > 4 * 1024 * 1024) {
            throw new AccountingError('processing_output_limit');
        }
        $parsed = app(PrivateProcess::class)->json(['node', base_path('processing/dist/receipt.cjs'), 'rows'], $text, $budget);

        return ['parsed' => $parsed, 'report' => ReceiptVerification::verify($parsed), 'rowsText' => $text];
    }

    public function pdf(string $path, ProcessingBudget $budget): array
    {
        $root = PrivateRoots::canonical((string) (config('tarjetas.processing_temp_root') ?: config('tarjetas.test_target.temp_root')));
        $best = null;
        foreach ([3, 2, 1.5] as $index => $scale) {
            $boxes = app(PrivateProcess::class)->json([config('tarjetas.python'), base_path('processing/receipt_vision.py'), $path, (string) $scale, (string) ($index + 1), $root], '', $budget, true);
            $result = app(PrivateProcess::class)->json(['node', base_path('processing/dist/receipt.cjs'), 'boxes'], json_encode($boxes, JSON_THROW_ON_ERROR), $budget);
            $result['report'] = ReceiptVerification::verify($result['parsed']);
            $result['scale'] = $scale;
            if ($result['report']['ok']) {
                return $result;
            }
            $failures = fn ($value) => count($value['report']['errors']) + count(array_filter($value['report']['checks'], fn ($check) => ! $check['ok']));
            if ($best === null || $failures($result) < $failures($best)) {
                $best = $result;
            }
        }

        return $best;
    }
}
