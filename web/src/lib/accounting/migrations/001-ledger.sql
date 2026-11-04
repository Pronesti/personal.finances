CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cards (id text PRIMARY KEY);
CREATE TABLE accounts (
 id text PRIMARY KEY, parent_id text REFERENCES accounts(id), type text NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
 label_key text, custom_name text, currency text CHECK(currency IN ('ARS','USD')), primary_purpose_id text,
 posting boolean NOT NULL, enabled boolean NOT NULL, CHECK(label_key IS NOT NULL OR nullif(trim(custom_name),'') IS NOT NULL)
);
CREATE TABLE evidence (id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('synthetic','statement','receipt')), metadata jsonb NOT NULL);
CREATE TABLE commands (key text PRIMARY KEY, card_id text REFERENCES cards(id), digest text NOT NULL, result jsonb NOT NULL);
CREATE TABLE journals (
 id text PRIMARY KEY, command_key text NOT NULL, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')),
 effective_date date NOT NULL, recorded_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('purchase','billing','repayment','credit','cost','opening','reversal','replacement')),
 reverses_id text REFERENCES journals(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted'))
);
CREATE TABLE journal_lines (
 journal_id text NOT NULL REFERENCES journals(id), ordinal integer NOT NULL CHECK(ordinal >= 0), account_id text NOT NULL REFERENCES accounts(id),
 debit_minor bigint NOT NULL CHECK(debit_minor BETWEEN 0 AND 9007199254740991), credit_minor bigint NOT NULL CHECK(credit_minor BETWEEN 0 AND 9007199254740991),
 purchase_id text, purpose_id text, PRIMARY KEY(journal_id,ordinal),
 CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE TABLE journal_evidence (journal_id text NOT NULL REFERENCES journals(id), evidence_id text NOT NULL REFERENCES evidence(id), PRIMARY KEY(journal_id,evidence_id));
CREATE FUNCTION guard_account() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.parent_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.parent_id AND type=NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
   IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM accounts WHERE id=NEW.parent_id UNION SELECT a.id,a.parent_id FROM accounts a JOIN ancestors p ON a.id=p.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'account_cycle'; END IF;
   IF EXISTS(SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=NEW.parent_id AND j.status='posted') THEN RAISE EXCEPTION 'posted_account_not_leaf'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=OLD.id AND j.status='posted') AND (NEW.type IS DISTINCT FROM OLD.type OR NEW.currency IS DISTINCT FROM OLD.currency OR NOT NEW.posting) THEN RAISE EXCEPTION 'posted_account_invariant'; END IF;
 IF TG_OP='UPDATE' AND NEW.type IS DISTINCT FROM OLD.type AND EXISTS(SELECT 1 FROM accounts WHERE parent_id=OLD.id AND type<>NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION guard_account();
CREATE FUNCTION guard_journal_child() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE state text;
BEGIN
 SELECT status INTO state FROM journals WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.journal_id ELSE NEW.journal_id END FOR UPDATE;
 IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF TG_OP='UPDATE' THEN
   SELECT status INTO state FROM journals WHERE id=OLD.journal_id FOR UPDATE;
   IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION guard_journal_child();
CREATE TRIGGER evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_evidence FOR EACH ROW EXECUTE FUNCTION guard_journal_child();
CREATE FUNCTION guard_journal() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE count_lines bigint; deb numeric; cred numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF TG_OP='INSERT' THEN
   IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'journal_requires_draft'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.status='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.status='posted' THEN
   SELECT count(*),sum(debit_minor),sum(credit_minor) INTO count_lines,deb,cred FROM journal_lines WHERE journal_id=NEW.id;
   IF count_lines<2 OR deb IS NULL OR deb<>cred OR deb<=0 OR deb>9007199254740991 THEN RAISE EXCEPTION 'unbalanced_journal'; END IF;
   IF NOT EXISTS(SELECT 1 FROM journal_evidence WHERE journal_id=NEW.id) THEN RAISE EXCEPTION 'missing_evidence'; END IF;
   IF EXISTS(SELECT 1 FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=NEW.id AND (NOT a.enabled OR NOT a.posting OR (a.currency IS NOT NULL AND a.currency<>NEW.currency) OR EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id=a.id))) THEN RAISE EXCEPTION 'invalid_posting_account'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION guard_journal();
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN RAISE EXCEPTION 'immutable_record'; END $$;
CREATE TRIGGER command_immutable BEFORE UPDATE OR DELETE ON commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(1);
