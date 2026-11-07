<?php

namespace Tests\Postgres;

use App\Models\Ledger;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class FoundationTest extends PostgresTestCase
{
    public function test_existing_users_have_distinct_immutable_ledgers_and_no_automatic_global_fallback(): void
    {
        DB::beginTransaction();
        try {
            $a = Ledger::factory()->create();
            $b = Ledger::factory()->create();
            $this->assertNotSame($a->id, $b->id);
            $this->assertSame($a->id, $a->owner->ledger->id);
            $this->assertNull(User::factory()->create()->ledger);
            DB::statement('SAVEPOINT immutable_ledger');
            try {
                DB::table('ledgers')->where('id', $a->id)->update(['owner_user_id' => $b->owner_user_id]);
                $this->fail('Ledger owner update must fail in PostgreSQL');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('immutable_ledger_identity', $exception->getMessage());
                DB::statement('ROLLBACK TO SAVEPOINT immutable_ledger');
            }
        } finally {
            DB::rollBack();
        }
    }
}
