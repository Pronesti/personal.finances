<?php

use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Bootstrap\HandleExceptions;

require dirname(__DIR__).'/vendor/autoload.php';

// The DB suite is separately invoked and guarded before PHPUnit can run hooks.
$arguments = implode(' ', $_SERVER['argv']);
if (preg_match('/(?:--testsuite(?:=|\s+)[^ ]*Postgres|tests\/Postgres)/', $arguments) || ! preg_match('/(?:--testsuite(?:=|\s+)(?:Unit|Feature)|tests\/(?:Unit|Feature))/', $arguments)) {
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    $app->make(TestTargetGuard::class)->check();
    HandleExceptions::flushState();
}
