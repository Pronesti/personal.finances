CREATE TABLE opening_obligations (id text PRIMARY KEY, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')), opening_journal_id text NOT NULL REFERENCES journals(id), payload jsonb NOT NULL);
CREATE TABLE opening_obligation_evidence (obligation_id text NOT NULL REFERENCES opening_obligations(id), evidence_id text NOT NULL REFERENCES evidence(id), PRIMARY KEY(obligation_id,evidence_id));
ALTER TABLE billings ADD COLUMN opening_obligation_id text REFERENCES opening_obligations(id);
ALTER TABLE billings ADD CONSTRAINT billing_one_origin CHECK (opening_obligation_id IS NULL OR purchase_id IS NULL);
CREATE UNIQUE INDEX opening_installment_identity ON billings(opening_obligation_id,installment) WHERE opening_obligation_id IS NOT NULL;
CREATE TRIGGER opening_obligation_immutable BEFORE UPDATE OR DELETE ON opening_obligations FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER opening_obligation_evidence_immutable BEFORE UPDATE OR DELETE ON opening_obligation_evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(12);
