<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ledgers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('owner_user_id')->unique()->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });
        DB::unprepared("CREATE FUNCTION guard_ledger_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable_ledger_identity'; END $$; CREATE TRIGGER ledger_identity_guard BEFORE UPDATE OR DELETE ON ledgers FOR EACH ROW EXECUTE FUNCTION guard_ledger_identity();");
    }

    public function down(): void
    {
        Schema::dropIfExists('ledgers');
        DB::unprepared('DROP FUNCTION IF EXISTS guard_ledger_identity()');
    }
};
