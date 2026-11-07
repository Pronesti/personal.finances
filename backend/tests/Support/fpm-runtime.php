<?php

use App\Support\TestTargetGuard;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$app->make(TestTargetGuard::class)->check();
if (! $app->environment('browser-testing')) {
    http_response_code(403);
    exit;
}
header('Content-Type: application/json');
echo json_encode(['sapi' => PHP_SAPI, 'php' => PHP_VERSION, 'upload_max_filesize' => ini_get('upload_max_filesize'), 'post_max_size' => ini_get('post_max_size'), 'max_execution_time' => ini_get('max_execution_time'), 'max_input_time' => ini_get('max_input_time'), 'max_file_uploads' => ini_get('max_file_uploads'), 'memory_limit' => ini_get('memory_limit'), 'upload_tmp_dir' => ini_get('upload_tmp_dir'), 'sys_temp_dir' => ini_get('sys_temp_dir'), 'environment' => $app->environment()], JSON_THROW_ON_ERROR);
