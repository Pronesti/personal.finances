-- Lossless migration provenance, separate from accepted accounting facts.
CREATE TABLE reconstruction_runs (
 id text PRIMARY KEY, source_digest text NOT NULL, configuration_digest text NOT NULL,
 cutoff_date date NOT NULL, mode text NOT NULL CHECK(mode IN ('historical','opening')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legacy_rows (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), table_name text NOT NULL,
 source_id text NOT NULL, row_hash text NOT NULL, payload jsonb NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('retained','review')),
 reason text, PRIMARY KEY(run_id,table_name,source_id)
);
CREATE TABLE legacy_objects (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), source_path text NOT NULL,
 sha256 text NOT NULL, byte_length bigint NOT NULL, object_path text NOT NULL,
 PRIMARY KEY(run_id,source_path)
);
CREATE TABLE legacy_id_map (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), table_name text NOT NULL,
 source_id text NOT NULL, target_kind text NOT NULL, target_id text NOT NULL,
 PRIMARY KEY(run_id,table_name,source_id,target_kind,target_id),
 FOREIGN KEY(run_id,table_name,source_id) REFERENCES legacy_rows(run_id,table_name,source_id)
);
CREATE TABLE reconstruction_reports (run_id text PRIMARY KEY REFERENCES reconstruction_runs(id), payload jsonb NOT NULL);
CREATE TRIGGER legacy_rows_immutable BEFORE UPDATE OR DELETE ON legacy_rows FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER legacy_objects_immutable BEFORE UPDATE OR DELETE ON legacy_objects FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER legacy_map_immutable BEFORE UPDATE OR DELETE ON legacy_id_map FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE OR REPLACE VIEW accounting_backup_metadata AS
SELECT jsonb_build_object(
 'app_revision', (SELECT app_revision FROM source_revisions ORDER BY ordinal DESC LIMIT 1),
 'schema_version', (SELECT max(version) FROM schema_migrations),
 'database', jsonb_build_object('path','database.dump','server_major',current_setting('server_version_num')::integer/10000),
 'source_references', COALESCE((SELECT jsonb_agg(path ORDER BY path) FROM
   (SELECT 'objects/' || relative_path AS path FROM source_documents UNION SELECT 'objects/' || object_path FROM legacy_objects) refs),'[]'::jsonb)
) AS metadata;
INSERT INTO schema_migrations(version) VALUES(9);
