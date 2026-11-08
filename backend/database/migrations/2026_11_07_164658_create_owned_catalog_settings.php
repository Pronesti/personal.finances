<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE FUNCTION accounting.guard_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_account_identity'; END IF;
 IF NEW.ledger_id<>OLD.ledger_id OR NEW.id<>OLD.id OR NEW.row_id<>OLD.row_id THEN RAISE EXCEPTION 'immutable_account_identity'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_identity_guard BEFORE UPDATE OR DELETE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_identity();
CREATE TABLE accounting.catalog_commands (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), key text NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
 UNIQUE(ledger_id,key), UNIQUE(ledger_id,row_id)
);
ALTER TABLE accounting.account_name_revisions ADD COLUMN version integer CHECK(version>0), ADD COLUMN previous_id text;
DROP TRIGGER account_name_immutable ON accounting.account_name_revisions;
WITH ordered AS (
 SELECT row_id,row_number() OVER(PARTITION BY ledger_id,account_id ORDER BY recorded_at,id)::integer AS version,
 lag(id) OVER(PARTITION BY ledger_id,account_id ORDER BY recorded_at,id) AS previous_id FROM accounting.account_name_revisions
) UPDATE accounting.account_name_revisions n SET version=o.version,previous_id=o.previous_id FROM ordered o WHERE n.row_id=o.row_id;
ALTER TABLE accounting.account_name_revisions ALTER COLUMN version SET NOT NULL,
 ADD UNIQUE(ledger_id,account_id,version), ADD FOREIGN KEY(ledger_id,previous_id) REFERENCES accounting.account_name_revisions(ledger_id,id);
CREATE TABLE accounting.account_groups (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, builtin boolean NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id)
);
CREATE TABLE accounting.account_group_revisions (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id uuid NOT NULL, group_id text NOT NULL, version integer NOT NULL CHECK(version>0), previous_id uuid,
 payload jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), UNIQUE(ledger_id,group_id,version),
 FOREIGN KEY(ledger_id,group_id) REFERENCES accounting.account_groups(ledger_id,id), FOREIGN KEY(ledger_id,previous_id) REFERENCES accounting.account_group_revisions(ledger_id,id)
);
CREATE TABLE accounting.account_group_members (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), revision_id uuid NOT NULL, account_id text NOT NULL,
 UNIQUE(ledger_id,row_id), UNIQUE(ledger_id,revision_id,account_id),
 FOREIGN KEY(ledger_id,revision_id) REFERENCES accounting.account_group_revisions(ledger_id,id), FOREIGN KEY(ledger_id,account_id) REFERENCES accounting.accounts(ledger_id,id)
);
CREATE FUNCTION accounting.guard_account_name_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest accounting.account_name_revisions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 SELECT * INTO latest FROM accounting.account_name_revisions WHERE ledger_id=NEW.ledger_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(latest.version,0)+1 OR NEW.previous_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION 'stale_catalog_version'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION accounting.guard_account_group_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest accounting.account_group_revisions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 SELECT * INTO latest FROM accounting.account_group_revisions WHERE ledger_id=NEW.ledger_id AND group_id=NEW.group_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(latest.version,0)+1 OR NEW.previous_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION 'stale_catalog_version'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_name_chain BEFORE INSERT ON accounting.account_name_revisions FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_name_revision();
CREATE TRIGGER account_group_chain BEFORE INSERT ON accounting.account_group_revisions FOR EACH ROW EXECUTE FUNCTION accounting.guard_account_group_revision();
CREATE TRIGGER account_names_immutable BEFORE UPDATE OR DELETE ON accounting.account_name_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER account_groups_immutable BEFORE UPDATE OR DELETE ON accounting.account_groups FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER account_group_versions_immutable BEFORE UPDATE OR DELETE ON accounting.account_group_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER account_group_members_immutable BEFORE UPDATE OR DELETE ON accounting.account_group_members FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER catalog_commands_immutable BEFORE UPDATE OR DELETE ON accounting.catalog_commands FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Catalog history rollback requires reviewed recovery.');
    }
};
