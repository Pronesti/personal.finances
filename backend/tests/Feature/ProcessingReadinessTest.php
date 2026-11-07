<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class ProcessingReadinessTest extends PostgresTestCase
{
    public function test_actual_bounded_runtime_probe_is_read_only_and_missing_dependencies_fail_closed(): void
    {
        config(['tarjetas.python' => base_path('.venv/bin/python')]);
        $before = DB::table('accounting.journals')->count();
        $this->artisan('tarjetas:readiness')->expectsOutputToContain('"ready":true')->assertExitCode(0);
        config(['tarjetas.python' => '/nonexistent/tarjetas-python']);
        $this->artisan('tarjetas:readiness')->expectsOutputToContain('"ready":false')->assertExitCode(1);
        $this->assertSame($before, DB::table('accounting.journals')->count());
    }
}
