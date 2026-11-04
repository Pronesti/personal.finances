CREATE TABLE purchases (id text PRIMARY KEY, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')));
CREATE TABLE purchase_versions (
 purchase_id text NOT NULL REFERENCES purchases(id),version integer NOT NULL CHECK(version>0),journal_id text NOT NULL UNIQUE REFERENCES journals(id),principal_minor bigint NOT NULL CHECK(principal_minor BETWEEN 1 AND 9007199254740991),payload jsonb NOT NULL,PRIMARY KEY(purchase_id,version)
);
CREATE TABLE billings (
 id text PRIMARY KEY, purchase_id text REFERENCES purchases(id),card_id text NOT NULL REFERENCES cards(id),currency text NOT NULL CHECK(currency IN ('ARS','USD')),installment integer NOT NULL CHECK(installment>0),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),journal_id text NOT NULL UNIQUE REFERENCES journals(id),payload jsonb NOT NULL,UNIQUE(purchase_id,installment)
);
CREATE TABLE billed_components (id text PRIMARY KEY,billing_id text NOT NULL REFERENCES billings(id),purpose_id text,minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991));
CREATE TABLE payments (id text PRIMARY KEY,card_id text NOT NULL REFERENCES cards(id),currency text NOT NULL CHECK(currency IN ('ARS','USD')),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),journal_id text NOT NULL UNIQUE REFERENCES journals(id),payload jsonb NOT NULL);
CREATE TABLE attributions (id text PRIMARY KEY,payment_id text NOT NULL REFERENCES payments(id),component_id text NOT NULL REFERENCES billed_components(id),purpose_id text,minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991),method text NOT NULL CHECK(method IN ('issuer','oldest_billed_first')),revision integer NOT NULL CHECK(revision>0),UNIQUE(payment_id,component_id,revision));
CREATE TABLE linked_credits (id text PRIMARY KEY,purchase_id text NOT NULL REFERENCES purchases(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),payload jsonb NOT NULL);
CREATE TRIGGER purchase_immutable BEFORE UPDATE OR DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER purchase_version_immutable BEFORE UPDATE OR DELETE ON purchase_versions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER billing_immutable BEFORE UPDATE OR DELETE ON billings FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER component_immutable BEFORE UPDATE OR DELETE ON billed_components FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER attribution_immutable BEFORE UPDATE OR DELETE ON attributions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER linked_credit_immutable BEFORE UPDATE OR DELETE ON linked_credits FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(2);
