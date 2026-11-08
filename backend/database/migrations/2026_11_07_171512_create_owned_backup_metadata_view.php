<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE VIEW accounting.backup_metadata AS
 SELECT r.ledger_id,r.kind,r.reference_id,r.relative_path,r.sha256,r.byte_length AS bytes,
 (SELECT max(migration) FROM public.migrations) AS schema_revision,
 current_setting('server_version_num')::integer/10000 AS postgres_major,
 (SELECT s.app_revision FROM accounting.source_revisions s WHERE s.ledger_id=r.ledger_id ORDER BY s.ordinal DESC LIMIT 1) AS app_revision
 FROM accounting.object_references r;
SQL);
    }

    public function down(): void
    {
        DB::statement('DROP VIEW accounting.backup_metadata');
    }
};
