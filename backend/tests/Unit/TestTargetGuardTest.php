<?php

namespace Tests\Unit;

use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use RuntimeException;
use Tests\TestCase;

class TestTargetGuardTest extends TestCase
{
    public function test_unapproved_and_non_postgres_configuration_are_refused_before_a_connection(): void
    {
        $app = $this->app;
        config(['database.default' => 'sqlite', 'database.connections.pgsql.host' => 'does-not-exist.invalid']);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('test_target_configuration');
        $app->make(TestTargetGuard::class)->check();
    }

    public function test_roots_use_path_boundaries(): void
    {
        $this->assertTrue(PrivateRoots::overlap('/private/test', '/private/test/documents'));
        $this->assertTrue(PrivateRoots::overlap('/private/test', '/private/test'));
        $this->assertFalse(PrivateRoots::overlap('/private/test', '/private/test-other'));
    }

    public function test_symlinks_and_unresolved_roots_are_refused(): void
    {
        $this->expectException(RuntimeException::class);
        PrivateRoots::canonical('/tmp/../tmp');
    }
}
