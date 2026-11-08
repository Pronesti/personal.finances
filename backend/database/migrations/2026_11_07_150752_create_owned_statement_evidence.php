<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.source_revisions (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY, source_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('statement','receipt')), card_id text,
 document_hash text NOT NULL, raw_object_hash text, previous_revision_id text, recorded_at timestamptz NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'), app_revision text NOT NULL CHECK(length(trim(app_revision))>0), payload jsonb NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), UNIQUE(ledger_id,kind,document_hash,payload_digest),
 CHECK(kind<>'statement' OR card_id IS NOT NULL), CHECK(COALESCE(payload->>'admission','') IN ('accepted','rejected','pending')),
 FOREIGN KEY(ledger_id,id) REFERENCES accounting.evidence(ledger_id,id),
 FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id),
 FOREIGN KEY(ledger_id,document_hash) REFERENCES accounting.source_documents(ledger_id,sha256),
 FOREIGN KEY(ledger_id,raw_object_hash) REFERENCES accounting.source_documents(ledger_id,sha256),
 FOREIGN KEY(ledger_id,previous_revision_id) REFERENCES accounting.source_revisions(ledger_id,id)
);
CREATE INDEX source_revisions_owner_key ON accounting.source_revisions(ledger_id,source_key,ordinal);
CREATE INDEX source_revisions_owner_previous ON accounting.source_revisions(ledger_id,previous_revision_id);
CREATE FUNCTION accounting.guard_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 IF NEW.previous_revision_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM accounting.source_revisions WHERE ledger_id=NEW.ledger_id AND source_key=NEW.source_key) THEN RAISE EXCEPTION 'missing_previous_revision'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM accounting.source_revisions WHERE ledger_id=NEW.ledger_id AND id=NEW.previous_revision_id AND kind=NEW.kind AND (source_key=NEW.source_key OR document_hash=NEW.document_hash AND (NEW.kind='receipt' AND payload->>'admission'='rejected' OR NEW.kind='statement' AND card_id=NEW.card_id AND NEW.payload->>'admission'='pending'))) THEN RAISE EXCEPTION 'invalid_previous_revision'; END IF;
  IF EXISTS(SELECT 1 FROM accounting.source_revisions WHERE ledger_id=NEW.ledger_id AND previous_revision_id=NEW.previous_revision_id) THEN RAISE EXCEPTION 'source_revision_fork'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_revision_guard BEFORE INSERT ON accounting.source_revisions FOR EACH ROW EXECUTE FUNCTION accounting.guard_source_revision();
CREATE TABLE accounting.source_lines (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL,
 revision_id text NOT NULL, occurrence integer NOT NULL CHECK(occurrence>=1), payload jsonb NOT NULL, legacy_fingerprint text,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), UNIQUE(ledger_id,revision_id,occurrence),
 FOREIGN KEY(ledger_id,id) REFERENCES accounting.evidence(ledger_id,id), FOREIGN KEY(ledger_id,revision_id) REFERENCES accounting.source_revisions(ledger_id,id)
);
CREATE TABLE accounting.source_import_commands (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), key text NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
 UNIQUE(ledger_id,key), UNIQUE(ledger_id,row_id)
);
CREATE TABLE accounting.source_purchase_identities (
 ledger_id uuid NOT NULL REFERENCES public.ledgers(id), source_line_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')),
 purchase_id text NOT NULL, card_id text NOT NULL, purchase_date date NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(ledger_id,source_line_id,currency), FOREIGN KEY(ledger_id,source_line_id) REFERENCES accounting.source_lines(ledger_id,id),
 FOREIGN KEY(ledger_id,purchase_id) REFERENCES accounting.purchases(ledger_id,id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id)
);
CREATE INDEX source_identity_owner_card ON accounting.source_purchase_identities(ledger_id,card_id,currency,purchase_date);
CREATE TABLE accounting.review_events (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 subject_id text NOT NULL, prior_decision_id text, code text NOT NULL, params jsonb NOT NULL, source_line_ids jsonb NOT NULL CHECK(jsonb_typeof(source_line_ids)='array'),
 state text NOT NULL CHECK(state IN ('open','reviewed','dismissed')), recorded_at timestamptz NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,subject_id) REFERENCES accounting.evidence(ledger_id,id),
 FOREIGN KEY(ledger_id,prior_decision_id) REFERENCES accounting.review_events(ledger_id,id)
);
CREATE FUNCTION accounting.guard_review_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.source_line_ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM accounting.source_lines WHERE ledger_id=NEW.ledger_id AND id=x.id)) THEN RAISE EXCEPTION 'review_source_owner_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_owner_guard BEFORE INSERT ON accounting.review_events FOR EACH ROW EXECUTE FUNCTION accounting.guard_review_owner();
CREATE TABLE accounting.statement_cycles (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), revision_id text NOT NULL, card_id text NOT NULL, closing_date date NOT NULL, period jsonb NOT NULL,
 UNIQUE(ledger_id,revision_id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,revision_id) REFERENCES accounting.source_revisions(ledger_id,id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id)
);
CREATE TABLE accounting.statement_terms (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), revision_id text NOT NULL, payload jsonb NOT NULL,
 UNIQUE(ledger_id,revision_id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,revision_id) REFERENCES accounting.source_revisions(ledger_id,id)
);
CREATE TABLE accounting.issuer_schedules (
 ledger_id uuid NOT NULL REFERENCES public.ledgers(id), revision_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=1), payload jsonb NOT NULL,
 PRIMARY KEY(ledger_id,revision_id,ordinal), FOREIGN KEY(ledger_id,revision_id) REFERENCES accounting.source_revisions(ledger_id,id)
);
CREATE TRIGGER source_revisions_immutable BEFORE UPDATE OR DELETE ON accounting.source_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER source_lines_immutable BEFORE UPDATE OR DELETE ON accounting.source_lines FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER source_import_commands_immutable BEFORE UPDATE OR DELETE ON accounting.source_import_commands FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER source_purchase_identities_immutable BEFORE UPDATE OR DELETE ON accounting.source_purchase_identities FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER review_events_immutable BEFORE UPDATE OR DELETE ON accounting.review_events FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER statement_cycles_immutable BEFORE UPDATE OR DELETE ON accounting.statement_cycles FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER statement_terms_immutable BEFORE UPDATE OR DELETE ON accounting.statement_terms FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER issuer_schedules_immutable BEFORE UPDATE OR DELETE ON accounting.issuer_schedules FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Evidence rollback requires an explicitly reviewed recovery operation.');
    }
};
