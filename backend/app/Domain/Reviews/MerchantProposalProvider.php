<?php

namespace App\Domain\Reviews;

interface MerchantProposalProvider
{
    /** Only sanitized merchant strings cross this boundary. */
    public function suggest(array $names): array;
}
