<?php

namespace Tests\Processing;

use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reports\ReportCalculator;
use Tests\PostgresTestCase;

class ReportProjectionTest extends PostgresTestCase
{
    private int $numeric = 0;

    private int $leaves = 0;

    private function compare(mixed $actual, mixed $expected, string $path = '$'): void
    {
        if (is_array($expected)) {
            $this->assertIsArray($actual, $path);
            $expectedKeys = array_keys($expected);
            $actualKeys = array_keys($actual);
            sort($expectedKeys);
            sort($actualKeys);
            $this->assertSame($expectedKeys, $actualKeys, $path);
            foreach ($expected as $key => $value) {
                $this->compare($actual[$key], $value, $path.'.'.$key);
            }

return;
        }
        $this->leaves++;
        if (is_int($expected) || is_float($expected)) {
            $this->numeric++;
            $this->assertTrue(is_int($actual) || is_float($actual), $path);
            $this->assertTrue(is_finite((float) $actual), $path);
            if (is_int($expected)) {
                $this->assertEquals($expected, $actual, $path);
            } else {
                $this->assertEqualsWithDelta($expected, $actual, 1e-9 * max(1, abs($expected)), $path);
            }
        } else {
            $this->assertSame($expected, $actual, $path);
        }
    }

    public function test_independent_backend_analytical_adapter_matches_every_frozen_report_projection(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $directory = base_path('../docs/rebuild/fixtures/');
        $input = json_decode(file_get_contents($directory.'report-input.json'), true);
        $input['supermarket'] = json_decode(file_get_contents($directory.'supermarket.json'), true);
        $input['snapshot'] = true;
        $actual = app(ReportCalculator::class)->calculate($input, new ProcessingBudget(30000, 0));
        $expected = json_decode(file_get_contents($directory.'reports.expected.json'), true);
        $this->compare($actual, $expected);
        $this->assertSame(2199, $this->numeric);
        $this->assertSame(3239,$this->leaves);
    }
}
