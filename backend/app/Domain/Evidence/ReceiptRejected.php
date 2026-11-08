<?php

namespace App\Domain\Evidence;

use App\Domain\Ledger\AccountingError;

class ReceiptRejected extends AccountingError
{
    public function __construct(public readonly array $receiptPayload)
    {
        parent::__construct('verification_failed', ['sourceRevisionId' => $receiptPayload['sourceRevisionId']]);
    }
}
