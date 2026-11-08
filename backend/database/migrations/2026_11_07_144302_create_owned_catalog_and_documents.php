<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE SCHEMA accounting;
CREATE TABLE accounting.accounts (
 row_id uuid PRIMARY KEY,
 ledger_id uuid NOT NULL REFERENCES public.ledgers(id),
 id text NOT NULL,
 parent_id text,
 type text NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
 label_key text, custom_name text,
 currency text CHECK(currency IN ('ARS','USD')),
 primary_purpose_id text,
 posting boolean NOT NULL, enabled boolean NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id),
 FOREIGN KEY(ledger_id,parent_id) REFERENCES accounting.accounts(ledger_id,id),
 CHECK(label_key IS NOT NULL OR nullif(trim(custom_name),'') IS NOT NULL)
);
CREATE INDEX accounts_parent_owner ON accounting.accounts(ledger_id,parent_id);
CREATE FUNCTION accounting.immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable_record'; END $$;
CREATE FUNCTION accounting.guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text, 8581401));
 IF TG_OP='UPDATE' AND (NEW.ledger_id <> OLD.ledger_id OR NEW.id <> OLD.id OR NEW.row_id <> OLD.row_id) THEN RAISE EXCEPTION 'immutable_account_identity'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM accounting.accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.parent_id AND type=NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
  IF EXISTS(WITH RECURSIVE ancestors AS (
   SELECT id,parent_id FROM accounting.accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.parent_id
   UNION SELECT a.id,a.parent_id FROM accounting.accounts a JOIN ancestors p ON a.id=p.parent_id WHERE a.ledger_id=NEW.ledger_id
  ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'account_cycle'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.type IS DISTINCT FROM OLD.type AND EXISTS(SELECT 1 FROM accounting.accounts WHERE ledger_id=OLD.ledger_id AND parent_id=OLD.id AND type<>NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account();
CREATE TABLE accounting.account_name_revisions (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id),
 id text NOT NULL, account_id text NOT NULL,
 custom_name text CHECK(custom_name IS NULL OR length(trim(custom_name))>0), recorded_at timestamptz NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id),
 CONSTRAINT account_name_same_ledger_fk FOREIGN KEY(ledger_id,account_id) REFERENCES accounting.accounts(ledger_id,id)
);
CREATE INDEX account_names_owner_account ON accounting.account_name_revisions(ledger_id,account_id,recorded_at);
CREATE TRIGGER account_name_immutable BEFORE UPDATE OR DELETE ON accounting.account_name_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TABLE accounting.source_documents (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 relative_path text NOT NULL,
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 0 AND 9007199254740991),
 UNIQUE(ledger_id,sha256), UNIQUE(ledger_id,row_id),
 CHECK(relative_path='ledgers/' || ledger_id::text || '/objects/' || sha256)
);
CREATE TRIGGER source_documents_immutable BEFORE UPDATE OR DELETE ON accounting.source_documents FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TABLE accounting.object_references (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id),
 kind text NOT NULL CHECK(kind IN ('object','pending')), reference_id text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), relative_path text NOT NULL,
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 0 AND 9007199254740991),
 UNIQUE(ledger_id,kind,reference_id), UNIQUE(ledger_id,row_id),
 CHECK((kind='object' AND relative_path='ledgers/' || ledger_id::text || '/objects/' || sha256)
 OR (kind='pending' AND reference_id ~ '^[a-zA-Z0-9_-]+$' AND relative_path='ledgers/' || ledger_id::text || '/pending/' || reference_id || '/' || sha256))
);
CREATE INDEX object_reference_owner_hash ON accounting.object_references(ledger_id,sha256);
CREATE TRIGGER object_references_immutable BEFORE UPDATE OR DELETE ON accounting.object_references FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TABLE accounting.object_references, accounting.source_documents, accounting.account_name_revisions, accounting.accounts; DROP FUNCTION accounting.guard_account(); DROP FUNCTION accounting.immutable_row(); DROP SCHEMA accounting;');
    }
};
