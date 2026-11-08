<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => array_values(array_filter(explode(',', env('CORS_ALLOWED_ORIGINS', '')))),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Accept', 'Content-Type', 'X-XSRF-TOKEN', 'X-CSRF-TOKEN', 'X-Requested-With', 'Idempotency-Key', 'Accept-Language'],
    'exposed_headers' => ['Content-Disposition'],
    'max_age' => 600,
    'supports_credentials' => true,
];
