<?php

namespace App\Domain\Reviews;

use App\Domain\Ledger\AccountingError;
use App\Support\TestTargetGuard;

/** Explicit synthetic acceptance adapter. Never contacts a provider. */
class SyntheticProposals implements MerchantProposalProvider
{
    public function __construct()
    {
        app(TestTargetGuard::class)->check();
    }

    public function suggest(array $names): array
    {
        if (! in_array(config('app.env'), ['testing', 'browser-testing'], true) || array_any($names, fn ($name) => ! str_contains($name, 'SYNTHETIC'))) {
            throw new AccountingError('proposals_unavailable');
        }

        return array_map(fn ($name) => ['name' => $name, 'accountId' => 'expense:food:groceries:pantry', 'purposeId' => 'food', 'confidence' => 0.4], $names);
    }
}
