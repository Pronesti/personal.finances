<?php

return [
    'anthropic_key' => env('ANTHROPIC_API_KEY'),
    'anthropic_model' => env('ANTHROPIC_MODEL'),
    'proposal_driver' => env('TARJETAS_PROPOSAL_DRIVER', 'disabled'),
    'frontend_url' => env('FRONTEND_URL'),
    'document_root' => env('TARJETAS_DOCUMENT_ROOT'),
    'reference_root' => env('TARJETAS_REFERENCE_DIR'),
    'python' => env('TARJETAS_PYTHON'),
    'pdf_script' => env('TARJETAS_PDF_SCRIPT'),
    'ocr_script' => env('TARJETAS_OCR_SCRIPT'),
    'node_helper' => env('TARJETAS_NODE_HELPER'),
    'processing_temp_root' => env('TARJETAS_PROCESSING_TEMP_ROOT'),
    'ingress_key' => env('TARJETAS_INGRESS_KEY'),
    'ingress_root' => env('TARJETAS_INGRESS_ROOT'),
    'revision' => env('ACCOUNTING_APP_REVISION'),
    'test_target' => [
        'id' => env('TARJETAS_TEST_TARGET_ID'),
        'registry' => env('TARJETAS_TEST_TARGET_REGISTRY'),
        'temp_root' => env('TARJETAS_TEST_TEMP_ROOT'),
    ],
];
