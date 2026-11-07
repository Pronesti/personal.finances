<?php

namespace App\Domain\Reviews;

use App\Domain\Ledger\AccountingError;

class DisabledProposals implements MerchantProposalProvider
{
    public function suggest(array $names): array
    {
        throw new AccountingError('proposals_unavailable');
    }
}
