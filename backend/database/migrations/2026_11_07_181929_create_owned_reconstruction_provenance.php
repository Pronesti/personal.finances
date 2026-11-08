<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.reconstruction_runs (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL REFERENCES public.ledgers(id),id text NOT NULL,source_digest text NOT NULL,configuration_digest text NOT NULL,
 cutoff_date date NOT NULL,mode text NOT NULL CHECK(mode IN ('historical','opening')),created_at timestamptz NOT NULL,UNIQUE(ledger_id,id),UNIQUE(ledger_id,row_id)
);
CREATE TABLE accounting.legacy_rows (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL,run_id text NOT NULL,table_name text NOT NULL,source_id text NOT NULL,row_hash text NOT NULL,payload jsonb NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('retained','review')),reason text,
 UNIQUE(ledger_id,run_id,table_name,source_id),UNIQUE(ledger_id,row_id),FOREIGN KEY(ledger_id,run_id) REFERENCES accounting.reconstruction_runs(ledger_id,id)
);
CREATE TABLE accounting.legacy_objects (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL,run_id text NOT NULL,source_path text NOT NULL,sha256 text NOT NULL,byte_length bigint NOT NULL CHECK(byte_length>=0),object_reference_id text NOT NULL,reference_kind text NOT NULL DEFAULT 'object' CHECK(reference_kind='object'),
 UNIQUE(ledger_id,run_id,source_path),FOREIGN KEY(ledger_id,run_id) REFERENCES accounting.reconstruction_runs(ledger_id,id),FOREIGN KEY(ledger_id,reference_kind,object_reference_id) REFERENCES accounting.object_references(ledger_id,kind,reference_id)
);
CREATE TABLE accounting.legacy_id_map (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL,run_id text NOT NULL,table_name text NOT NULL,source_id text NOT NULL,target_kind text NOT NULL CHECK(target_kind IN ('source_revision','source_line')),target_id text NOT NULL,
 UNIQUE(ledger_id,run_id,table_name,source_id,target_kind,target_id),
 FOREIGN KEY(ledger_id,run_id,table_name,source_id) REFERENCES accounting.legacy_rows(ledger_id,run_id,table_name,source_id),
 FOREIGN KEY(ledger_id,target_id) REFERENCES accounting.evidence(ledger_id,id)
);
CREATE TABLE accounting.reconstruction_reports (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL,run_id text NOT NULL,payload jsonb NOT NULL,UNIQUE(ledger_id,run_id),FOREIGN KEY(ledger_id,run_id) REFERENCES accounting.reconstruction_runs(ledger_id,id)
);
CREATE TRIGGER reconstruction_runs_immutable BEFORE UPDATE OR DELETE ON accounting.reconstruction_runs FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER legacy_rows_immutable BEFORE UPDATE OR DELETE ON accounting.legacy_rows FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER legacy_objects_immutable BEFORE UPDATE OR DELETE ON accounting.legacy_objects FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER legacy_maps_immutable BEFORE UPDATE OR DELETE ON accounting.legacy_id_map FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER reconstruction_reports_immutable BEFORE UPDATE OR DELETE ON accounting.reconstruction_reports FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Reconstruction provenance requires reviewed recovery.');
    }
};
