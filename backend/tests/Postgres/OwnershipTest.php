<?php

namespace Tests\Postgres;

use App\Models\Account;
use App\Models\Ledger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\PostgresTestCase;

class OwnershipTest extends PostgresTestCase
{
    public function test_actual_account_revision_fk_rejects_exclusive_other_owner_tuple_with_successful_controls(): void
    {
        DB::beginTransaction();
        try {
            $a = Ledger::factory()->create();
            $b = Ledger::factory()->create();
            foreach ([$a, $b] as $ledger) {
                Account::factory()->create(['ledger_id' => $ledger->id, 'id' => 'expense:food:groceries:pantry']);
            }
            Account::factory()->create(['ledger_id' => $b->id, 'id' => 'expense:synthetic:b-only']);
            $snapshot = fn () => DB::table('accounting.account_name_revisions')->orderBy('row_id')->get()->toJson();
            $before = $snapshot();
            foreach ([[$a->id, 'expense:food:groceries:pantry'], [$b->id, 'expense:food:groceries:pantry'], [$b->id, 'expense:synthetic:b-only'], [$a->id, 'expense:synthetic:b-only']] as $index => [$owner, $key]) {
                DB::statement('SAVEPOINT owner_fk');
                try {
                    DB::table('accounting.account_name_revisions')->insert(['row_id' => Str::uuid()->toString(), 'ledger_id' => $owner, 'id' => Str::uuid()->toString(), 'account_id' => $key, 'version' => 1, 'previous_id' => null, 'custom_name' => 'Synthetic name', 'recorded_at' => now()]);
                    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
                    $this->assertLessThan(3, $index, 'A/B-exclusive must fail in the actual FK');
                    $this->assertSame($owner, DB::table('accounting.accounts')->where('ledger_id', $owner)->where('id', $key)->value('ledger_id'));
                } catch (QueryException $exception) {
                    $this->assertSame(3, $index);
                    $this->assertSame('23503', $exception->errorInfo[0]);
                    $this->assertStringContainsString('account_name_same_ledger_fk', $exception->getMessage());
                } finally {
                    DB::statement('ROLLBACK TO SAVEPOINT owner_fk');
                }
                $this->assertSame($before, $snapshot());
            }
        } finally {
            DB::rollBack();
        }
    }

    public function test_eloquent_saves_use_surrogate_row_id_and_do_not_mutate_colliding_logical_key(): void
    {
        DB::beginTransaction();
        try {
            $a = Account::factory()->create(['id' => 'expense:food:groceries:pantry', 'custom_name' => 'Pantry A']);
            $b = Account::factory()->create(['id' => 'expense:food:groceries:pantry', 'custom_name' => 'Pantry B']);
            $this->assertNotSame($a->getKey(), $b->getKey());
            $this->assertSame('row_id', $a->getKeyName());
            $a->custom_name = 'Pantry A changed';
            $a->save();
            $this->assertSame('Pantry A changed', $a->fresh()->custom_name);
            $this->assertSame('Pantry B', $b->fresh()->custom_name);
        } finally {
            DB::rollBack();
        }
    }
}
