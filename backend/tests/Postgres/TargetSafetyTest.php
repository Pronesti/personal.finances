<?php

namespace Tests\Postgres;

use App\Support\TestTargetGuard;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\PostgresTestCase;

class TargetSafetyTest extends PostgresTestCase
{
    public function test_guard_refuses_unsafe_resolved_settings_without_writes(): void
    {
        $cases = [
            ['app.env' => 'local'],
            ['database.default' => 'sqlite'],
            ['database.connections.pgsql.database' => 'tarjetas_live'],
            ['database.connections.pgsql.username' => 'wrong_role'],
            ['tarjetas.test_target.id' => 'unapproved-worker-2'],
            ['tarjetas.test_target.registry' => ''],
            ['tarjetas.document_root' => config('tarjetas.reference_root')],
            ['session.driver' => 'array'],
        ];
        foreach ($cases as $case) {
            $original = [];
            foreach ($case as $key => $value) {
                $original[$key] = config($key);
            }
            config($case);
            DB::purge();
            try {
                app(TestTargetGuard::class)->check();
                $this->fail('Unsafe target accepted');
            } catch (RuntimeException $exception) {
                $this->assertStringContainsString('Disposable PostgreSQL target refused', $exception->getMessage());
            } finally {
                config($original);
                DB::purge();
            }
        }
    }
}
