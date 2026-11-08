<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE FUNCTION accounting.guard_legacy_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='legacy_objects' THEN
  IF NOT EXISTS(SELECT 1 FROM accounting.object_references r WHERE r.ledger_id=NEW.ledger_id AND r.kind='object' AND r.reference_id=NEW.object_reference_id AND r.sha256=NEW.sha256 AND r.byte_length=NEW.byte_length) THEN RAISE EXCEPTION 'legacy_object_reference_mismatch'; END IF;
 ELSE
  IF NEW.target_kind='source_revision' AND NOT EXISTS(SELECT 1 FROM accounting.source_revisions s WHERE s.ledger_id=NEW.ledger_id AND s.id=NEW.target_id) THEN RAISE EXCEPTION 'legacy_mapping_kind_mismatch'; END IF;
  IF NEW.target_kind='source_line' AND NOT EXISTS(SELECT 1 FROM accounting.source_lines s WHERE s.ledger_id=NEW.ledger_id AND s.id=NEW.target_id) THEN RAISE EXCEPTION 'legacy_mapping_kind_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_object_binding BEFORE INSERT ON accounting.legacy_objects FOR EACH ROW EXECUTE FUNCTION accounting.guard_legacy_binding();
CREATE TRIGGER legacy_map_binding BEFORE INSERT ON accounting.legacy_id_map FOR EACH ROW EXECUTE FUNCTION accounting.guard_legacy_binding();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Reconstruction guard rollback requires reviewed recovery.');
    }
};
