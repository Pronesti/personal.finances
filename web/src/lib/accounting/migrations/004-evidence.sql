CREATE TABLE source_documents (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 relative_path text NOT NULL CHECK(relative_path=sha256),
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE source_revisions (
 id text PRIMARY KEY REFERENCES evidence(id), ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, source_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('statement','receipt')), card_id text REFERENCES cards(id),
 document_hash text NOT NULL REFERENCES source_documents(sha256), raw_object_hash text REFERENCES source_documents(sha256),
 previous_revision_id text REFERENCES source_revisions(id), recorded_at timestamptz NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 app_revision text NOT NULL CHECK(length(trim(app_revision))>0), payload jsonb NOT NULL,
 UNIQUE(kind,document_hash,payload_digest), CHECK(kind<>'statement' OR card_id IS NOT NULL),
 CHECK(COALESCE(payload->>'admission','') IN ('accepted','rejected','pending'))
);
CREATE FUNCTION guard_source_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.previous_revision_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM source_revisions WHERE source_key=NEW.source_key) THEN RAISE EXCEPTION 'missing_previous_revision'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM source_revisions WHERE id=NEW.previous_revision_id AND kind=NEW.kind AND (source_key=NEW.source_key OR document_hash=NEW.document_hash AND (NEW.kind='receipt' AND payload->>'admission'='rejected' OR NEW.kind='statement' AND card_id=NEW.card_id AND NEW.payload->>'admission'='pending'))) THEN RAISE EXCEPTION 'invalid_previous_revision'; END IF;
   IF EXISTS(SELECT 1 FROM source_revisions WHERE previous_revision_id=NEW.previous_revision_id) THEN RAISE EXCEPTION 'source_revision_fork'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_revision_guard BEFORE INSERT ON source_revisions FOR EACH ROW EXECUTE FUNCTION guard_source_revision();
CREATE INDEX source_revisions_key ON source_revisions(source_key);
CREATE TABLE source_lines (
 id text PRIMARY KEY REFERENCES evidence(id), revision_id text NOT NULL REFERENCES source_revisions(id),
 occurrence integer NOT NULL CHECK(occurrence>=1), payload jsonb NOT NULL, legacy_fingerprint text,
 UNIQUE(revision_id,occurrence)
);
CREATE TABLE source_import_commands (key text PRIMARY KEY, digest text NOT NULL, result jsonb NOT NULL);
CREATE TABLE source_purchase_identities (
 source_line_id text NOT NULL REFERENCES source_lines(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')),
 purchase_id text NOT NULL REFERENCES purchases(id), card_id text NOT NULL REFERENCES cards(id), purchase_date date NOT NULL,
 payload jsonb NOT NULL, PRIMARY KEY(source_line_id,currency)
);
CREATE TABLE review_events (
 id text PRIMARY KEY, ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, subject_id text NOT NULL REFERENCES evidence(id), prior_decision_id text REFERENCES review_events(id),
 code text NOT NULL, params jsonb NOT NULL, source_line_ids jsonb NOT NULL CHECK(jsonb_typeof(source_line_ids)='array'),
 state text NOT NULL CHECK(state IN ('open','reviewed','dismissed')), recorded_at timestamptz NOT NULL
);
CREATE TRIGGER source_documents_immutable BEFORE UPDATE OR DELETE ON source_documents FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_revisions_immutable BEFORE UPDATE OR DELETE ON source_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_lines_immutable BEFORE UPDATE OR DELETE ON source_lines FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_commands_immutable BEFORE UPDATE OR DELETE ON source_import_commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_identities_immutable BEFORE UPDATE OR DELETE ON source_purchase_identities FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_reviews_immutable BEFORE UPDATE OR DELETE ON review_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- Search-path qualified by the owning migration transaction; the view belongs to that schema.
CREATE VIEW accounting_backup_metadata AS
SELECT jsonb_build_object(
 'app_revision', (SELECT app_revision FROM source_revisions ORDER BY ordinal DESC LIMIT 1),
 'schema_version', (SELECT max(version) FROM schema_migrations),
 'database', jsonb_build_object('path','database.dump','server_major',current_setting('server_version_num')::integer/10000),
 'source_references', COALESCE((SELECT jsonb_agg('objects/' || relative_path ORDER BY relative_path) FROM source_documents),'[]'::jsonb)
) AS metadata;
INSERT INTO schema_migrations(version) VALUES(4);
