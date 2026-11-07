<?php

namespace App\Domain\Ledger;

class CatalogBootstrap
{
    public function initialize(LedgerRepository $ledger, array $cards): void
    {
        $ledger->transaction(function () use ($ledger, $cards): void {
            $catalog = json_decode(file_get_contents(resource_path('catalog.json')), true, flags: JSON_THROW_ON_ERROR);
            foreach ($catalog['accounts'] as $account) {
                $this->account($ledger, $account);
            }
            foreach ($cards as $card) {
                if (! is_string($card['id']) || trim($card['id']) === '' || ! is_string($card['displayName']) || trim($card['displayName']) === '') {
                    throw new AccountingError('invalid_card_identity');
                }
                if (! $ledger->query('cards')->where('id', $card['id'])->exists()) {
                    $ledger->insert('cards', ['id' => $card['id']]);
                }
                $root = 'card:'.$card['id'];
                $base = ['type' => 'liability', 'labelKey' => null, 'customName' => $card['displayName'], 'currency' => null, 'primaryPurposeId' => null, 'posting' => false, 'enabled' => true];
                $this->account($ledger, [...$base, 'id' => $root, 'parentId' => 'liability']);
                foreach (['ARS', 'USD'] as $currency) {
                    $this->account($ledger, [...$base, 'id' => $root.':'.$currency, 'parentId' => $root, 'customName' => $currency, 'currency' => $currency]);
                    foreach (['billed', 'unbilled'] as $state) {
                        $this->account($ledger, [...$base, 'id' => $card['id'].':'.$currency.':'.$state, 'parentId' => $root.':'.$currency, 'labelKey' => 'accounting.account.'.$state, 'customName' => null, 'currency' => $currency, 'posting' => true]);
                    }
                }
            }
        });
    }

    private function account(LedgerRepository $ledger, array $account): void
    {
        if ($ledger->query('accounts')->where('id', $account['id'])->exists()) {
            return;
        }
        $ledger->insert('accounts', [
            'id' => $account['id'], 'parent_id' => $account['parentId'], 'type' => $account['type'], 'label_key' => $account['labelKey'], 'custom_name' => $account['customName'], 'currency' => $account['currency'], 'primary_purpose_id' => $account['primaryPurposeId'], 'posting' => $account['posting'], 'enabled' => $account['enabled'],
        ]);
    }
}
