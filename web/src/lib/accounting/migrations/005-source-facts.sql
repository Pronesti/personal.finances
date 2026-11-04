CREATE TABLE statement_cycles (
 revision_id text PRIMARY KEY REFERENCES source_revisions(id), card_id text NOT NULL REFERENCES cards(id),
 closing_date date NOT NULL, period jsonb NOT NULL, UNIQUE(card_id,closing_date,revision_id)
);
CREATE TABLE statement_terms (revision_id text PRIMARY KEY REFERENCES source_revisions(id), payload jsonb NOT NULL);
CREATE TABLE issuer_schedules (revision_id text NOT NULL REFERENCES source_revisions(id), ordinal integer NOT NULL CHECK(ordinal>=1), payload jsonb NOT NULL, PRIMARY KEY(revision_id,ordinal));
CREATE TRIGGER statement_cycles_immutable BEFORE UPDATE OR DELETE ON statement_cycles FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER statement_terms_immutable BEFORE UPDATE OR DELETE ON statement_terms FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER issuer_schedules_immutable BEFORE UPDATE OR DELETE ON issuer_schedules FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(5);
