<?php

namespace App\Domain\Catalog;

use App\Domain\Ledger\AccountingError;
use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use Illuminate\Support\Str;

class CatalogSettings
{
    public function __construct(private LedgerRepository $repository) {}

    public function read(): array
    {
        return $this->repository->readSnapshot(function () {
            $versions = [];
            foreach ($this->repository->query('account_name_revisions')->orderBy('version')->get() as $row) {
                $versions[$row->account_id] = $row->version;
            }
            $accounts = $this->repository->query('accounts')->orderBy('id')->get()->map(fn ($row) => ['id' => $row->id, 'parentId' => $row->parent_id, 'type' => $row->type, 'labelKey' => $row->label_key, 'customName' => $row->custom_name, 'currency' => $row->currency, 'primaryPurposeId' => $row->primary_purpose_id, 'posting' => $row->posting, 'enabled' => $row->enabled, 'version' => $versions[$row->id] ?? 0])->all();

            return ['accounts' => $accounts, 'groups' => $this->groups()];
        });
    }

    public function groups(): array
    {
        $owned = $this->repository->query('accounts')->pluck('id')->all();
        $groups = [];
        foreach (json_decode(file_get_contents(resource_path('catalog.json')), true)['groups'] as $group) {
            if (array_diff($group['accountIds'], $owned) === []) {
                $groups[$group['id']] = [...$group, 'version' => 0, 'builtin' => true];
            }
        }
        foreach ($this->repository->query('account_group_revisions')->orderBy('version')->get() as $row) {
            $groups[$row->group_id] = [...json_decode($row->payload, true), 'version' => $row->version, 'builtin' => ! str_starts_with($row->group_id, 'group:')];
        }

        return array_values($groups);
    }

    private function command(array $input, callable $work): array
    {
        return $this->repository->transaction(function () use ($input, $work) {
            $key = 'catalog:'.rawurlencode($input['key']);
            $digest = FinancialCommands::digest($input);
            $saved = $this->repository->query('catalog_commands')->where('key', $key)->first();
            if ($saved !== null) {
                if ($saved->digest !== $digest) {
                    throw new AccountingError('command_conflict');
                }

                return [...json_decode($saved->result, true), 'duplicate' => true];
            }
            $result = [...$work(), 'duplicate' => false];
            $this->repository->insert('catalog_commands', ['key' => $key, 'digest' => $digest, 'result' => LedgerRepository::json($result)]);

            return $result;
        });
    }

    private static function name(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }if (! is_string($value) || trim($value) === '' || mb_strlen(trim($value)) > 300) {
            throw new AccountingError('invalid_custom_name');
        }

        return trim($value);
    }

    public function rename(array $input): array
    {
        return $this->command($input, function () use ($input) {
            $account = $this->repository->query('accounts')->where('id', $input['accountId'])->first();
            abort_if($account === null, 404);
            $name = self::name($input['customName']);
            if ($name === null && $account->label_key === null) {
                throw new AccountingError('missing_account_label');
            }
            $previous = $this->repository->query('account_name_revisions')->where('account_id', $input['accountId'])->orderByDesc('version')->first();
            if ($input['expectedVersion'] !== ($previous?->version ?? 0)) {
                throw new AccountingError('stale_catalog_version');
            }
            $version = ($previous?->version ?? 0) + 1;
            $this->repository->insert('account_name_revisions', ['id' => Str::uuid()->toString(), 'account_id' => $account->id, 'version' => $version, 'previous_id' => $previous?->id, 'custom_name' => $name, 'recorded_at' => $input['recordedAt']]);
            $this->repository->query('accounts')->where('id', $account->id)->update(['custom_name' => $name]);

            return ['accountId' => $account->id, 'customName' => $name, 'version' => $version];
        });
    }

    public function saveGroup(array $input): array
    {
        return $this->command($input, function () use ($input) {
            $existing = $input['groupId'] === null ? null : array_values(array_filter($this->groups(), fn ($row) => $row['id'] === $input['groupId']))[0] ?? null;
            if ($input['groupId'] !== null && $existing === null) {
                abort(404);
            }
            if ($input['expectedVersion'] !== ($existing['version'] ?? 0)) {
                throw new AccountingError('stale_catalog_version');
            }
            $builtin = $existing['builtin'] ?? false;
            $id = $existing['id'] ?? 'group:'.Str::uuid();
            $name = self::name($input['customName']);
            if (! $builtin && $name === null) {
                throw new AccountingError('invalid_custom_name');
            }
            $members = $builtin ? $existing['accountIds'] : $input['accountIds'];
            if (! is_array($members) || $members === [] || count($members) > 500 || count(array_unique($members)) !== count($members)) {
                throw new AccountingError('invalid_group');
            }
            foreach ($members as $member) {
                $account = $this->repository->query('accounts')->where('id', $member)->first();
                if ($account === null) {
                    abort(404);
                }if ($builtin && $account->primary_purpose_id !== $id) {
                    throw new AccountingError('invalid_primary_purpose');
                }
            }
            if (! $this->repository->query('account_groups')->where('id', $id)->exists()) {
                $this->repository->insert('account_groups', ['id' => $id, 'builtin' => $builtin]);
            }
            $previous = $this->repository->query('account_group_revisions')->where('group_id', $id)->orderByDesc('version')->first();
            $version = ($previous?->version ?? 0) + 1;
            $revision = Str::uuid()->toString();
            $group = ['id' => $id, 'customName' => $name, 'labelKey' => $builtin ? $existing['labelKey'] : null, 'accountIds' => $members, 'additive' => $builtin];
            $this->repository->insert('account_group_revisions', ['id' => $revision, 'group_id' => $id, 'version' => $version, 'previous_id' => $previous?->id, 'payload' => LedgerRepository::json($group), 'recorded_at' => $input['recordedAt']]);
            foreach ($members as $member) {
                $this->repository->insert('account_group_members', ['revision_id' => $revision, 'account_id' => $member]);
            }

            return ['groupId' => $id, 'version' => $version];
        });
    }
}
