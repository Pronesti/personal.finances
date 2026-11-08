<?php

namespace Tests\Feature;

use App\Domain\Catalog\CatalogSettings;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class CatalogSettingsTest extends PostgresTestCase
{
    public function test_names_and_cross_type_groups_are_owned_versioned_and_replayable(): void
    {
        $owners = [Ledger::factory()->create(), Ledger::factory()->create()];
        foreach ($owners as $owner) {
            app(CatalogBootstrap::class)->initialize(new LedgerRepository($owner), [['id' => 'catalog-card', 'displayName' => 'Catalog card']]);
        }
        $account = 'expense:food:groceries:pantry';
        foreach ($owners as $index => $owner) {
            app('auth')->forgetGuards();
            $this->actingAs($owner->owner, 'web');
            $input = ['accountId' => $account, 'customName' => 'Literal '.$index, 'expectedVersion' => 0];
            $this->postJson('/api/v1/accounting/settings/account-name', $input, ['Idempotency-Key' => 'same-key'])->assertOk()->assertJsonPath('version', 1)->assertJsonPath('duplicate', false);
            $this->postJson('/api/v1/accounting/settings/account-name', $input, ['Idempotency-Key' => 'same-key', 'Accept-Language' => 'es'])->assertOk()->assertJsonPath('duplicate', true);
            $this->postJson('/api/v1/accounting/settings/account-name', $input, ['Idempotency-Key' => 'stale-key'])->assertStatus(409)->assertJsonPath('error.code', 'stale_catalog_version');
            app(CatalogBootstrap::class)->initialize(new LedgerRepository($owner), [['id' => 'catalog-card', 'displayName' => 'Catalog card']]);
            $accounts = $this->getJson('/api/v1/accounting/settings')->assertOk()->json('accounts');
            $this->assertSame('Literal '.$index, array_values(array_filter($accounts, fn ($row) => $row['id'] === $account))[0]['customName']);
            $group = ['groupId' => null, 'customName' => 'Mixed '.$index, 'expectedVersion' => 0, 'accountIds' => ['expense:food', $account, 'catalog-card:ARS:billed']];
            $response = $this->postJson('/api/v1/accounting/settings/groups', $group, ['Idempotency-Key' => 'group-key'])->assertOk()->assertJsonPath('version', 1);
            $ids[$index] = $response->json('groupId');
            $this->postJson('/api/v1/accounting/settings/groups', $group, ['Idempotency-Key' => 'group-key'])->assertOk()->assertJsonPath('groupId', $ids[$index])->assertJsonPath('duplicate', true);
            $this->postJson('/api/v1/accounting/settings/account-name', [...$input, 'customName' => null, 'expectedVersion' => 1], ['Idempotency-Key' => 'reset'])->assertOk()->assertJsonPath('customName', null)->assertJsonPath('version', 2);
            $this->postJson('/api/v1/accounting/settings/groups', ['groupId' => 'food', 'customName' => 'Food literal', 'expectedVersion' => 0, 'accountIds' => ['catalog-card:ARS:billed']], ['Idempotency-Key' => 'builtin'])->assertOk();
            $groups = $this->getJson('/api/v1/accounting/settings')->assertOk()->json('groups');
            $food = array_values(array_filter($groups, fn ($row) => $row['id'] === 'food'))[0];
            $this->assertTrue($food['additive']);
            $this->assertNotContains('catalog-card:ARS:billed', $food['accountIds']);
            $this->assertSame(0, (new LedgerRepository($owner))->query('journals')->count());
        }
        app('auth')->forgetGuards();
        $this->actingAs($owners[0]->owner, 'web')->postJson('/api/v1/accounting/settings/groups', ['groupId' => $ids[1], 'customName' => 'foreign', 'expectedVersion' => 1, 'accountIds' => [$account]], ['Idempotency-Key' => 'foreign'])->assertNotFound();
        $this->getJson('/api/v1/accounting/settings?ledger_id='.$owners[1]->id)->assertStatus(400);
    }

    public function test_raw_group_membership_rejects_foreign_account_and_keeps_same_owner_positive_control(): void
    {
        $a = new LedgerRepository(Ledger::factory()->create());
        $b = new LedgerRepository(Ledger::factory()->create());
        app(CatalogBootstrap::class)->initialize($a, [['id' => 'exclusive-a', 'displayName' => 'A']]);
        app(CatalogBootstrap::class)->initialize($b, [['id' => 'exclusive-b', 'displayName' => 'B']]);
        $settings = new CatalogSettings($a);
        $result = $settings->saveGroup(['groupId' => null, 'customName' => 'A', 'expectedVersion' => 0, 'accountIds' => ['expense:food'], 'key' => 'raw', 'recordedAt' => now()->toIso8601String()]);
        $revision = $a->query('account_group_revisions')->where('group_id', $result['groupId'])->value('id');
        try {
            $a->transaction(fn () => $a->insert('account_group_members', ['revision_id' => $revision, 'account_id' => 'exclusive-b:ARS:billed']));
            $this->fail('Cross-owner membership was accepted.');
        } catch (QueryException $error) {
            $this->assertSame('23503', $error->errorInfo[0]);
            $this->assertStringContainsString('account_group_members_ledger_id_account_id_fkey', $error->getMessage());
        }
        $a->transaction(fn () => $a->insert('account_group_members', ['revision_id' => $revision, 'account_id' => 'exclusive-a:ARS:billed']));
        $this->assertSame(2, $a->query('account_group_members')->count());
        try {
            DB::table('accounting.account_group_revisions')->where('ledger_id', $a->ledger->id)->where('id', $revision)->update(['payload' => '{}']);
            $this->fail('History update was accepted.');
        } catch (QueryException $error) {
            $this->assertSame('P0001', $error->errorInfo[0]);
            $this->assertStringContainsString('immutable_record', $error->getMessage());
        }
    }
}
