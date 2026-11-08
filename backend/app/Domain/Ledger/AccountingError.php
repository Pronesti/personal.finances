<?php

namespace App\Domain\Ledger;

use RuntimeException;

class AccountingError extends RuntimeException
{
    public function __construct(public readonly string $errorCode, public readonly array $parameters = [])
    {
        parent::__construct($errorCode);
    }
}
