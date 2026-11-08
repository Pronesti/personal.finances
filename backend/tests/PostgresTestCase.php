<?php

namespace Tests;

use App\Support\TestTargetGuard;
use Illuminate\Foundation\Application;

abstract class PostgresTestCase extends TestCase
{
    public function createApplication(): Application
    {
        $app = parent::createApplication();
        $app->make(TestTargetGuard::class)->check();

        return $app;
    }
}
