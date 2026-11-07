<?php

return [
    'frontend_url' => env('FRONTEND_URL'),
    'document_root' => env('TARJETAS_DOCUMENT_ROOT'),
    'reference_root' => env('TARJETAS_REFERENCE_DIR'),
    'python' => env('TARJETAS_PYTHON'),
    'pdf_script' => env('TARJETAS_PDF_SCRIPT'),
    'ocr_script' => env('TARJETAS_OCR_SCRIPT'),
    'node_helper' => env('TARJETAS_NODE_HELPER'),
    'revision' => env('ACCOUNTING_APP_REVISION'),
    'test_target' => [
        'id' => env('TARJETAS_TEST_TARGET_ID'),
        'registry' => env('TARJETAS_TEST_TARGET_REGISTRY'),
        'temp_root' => env('TARJETAS_TEST_TEMP_ROOT'),
    ],
];
