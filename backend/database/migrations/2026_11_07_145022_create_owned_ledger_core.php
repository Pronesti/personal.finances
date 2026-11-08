<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.cards (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id));
CREATE TABLE accounting.evidence (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, kind text NOT NULL CHECK(kind IN ('synthetic','statement','receipt')), metadata jsonb NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id));
CREATE TABLE accounting.commands (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), key text NOT NULL, card_id text, digest text NOT NULL, result jsonb NOT NULL, UNIQUE(ledger_id,key), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id));
CREATE TABLE accounting.journals (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, command_key text NOT NULL, card_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')), effective_date date NOT NULL, recorded_at timestamptz NOT NULL, kind text NOT NULL CHECK(kind IN ('purchase','billing','repayment','credit','cost','opening','reversal','replacement')), reverses_id text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id), FOREIGN KEY(ledger_id,reverses_id) REFERENCES accounting.journals(ledger_id,id));
CREATE TABLE accounting.journal_lines (ledger_id uuid NOT NULL REFERENCES public.ledgers(id), journal_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), account_id text NOT NULL, debit_minor bigint NOT NULL CHECK(debit_minor BETWEEN 0 AND 9007199254740991), credit_minor bigint NOT NULL CHECK(credit_minor BETWEEN 0 AND 9007199254740991), purchase_id text, purpose_id text, PRIMARY KEY(ledger_id,journal_id,ordinal), CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), FOREIGN KEY(ledger_id,account_id) REFERENCES accounting.accounts(ledger_id,id));
CREATE TABLE accounting.journal_evidence (ledger_id uuid NOT NULL REFERENCES public.ledgers(id), journal_id text NOT NULL, evidence_id text NOT NULL, PRIMARY KEY(ledger_id,journal_id,evidence_id), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), FOREIGN KEY(ledger_id,evidence_id) REFERENCES accounting.evidence(ledger_id,id));
CREATE TABLE accounting.purchases (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, card_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id));
CREATE TABLE accounting.purchase_versions (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), purchase_id text NOT NULL, version integer NOT NULL CHECK(version>0), journal_id text NOT NULL, principal_minor bigint NOT NULL CHECK(principal_minor BETWEEN 1 AND 9007199254740991), payload jsonb NOT NULL, UNIQUE(ledger_id,purchase_id,version), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,purchase_id) REFERENCES accounting.purchases(ledger_id,id), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), UNIQUE(ledger_id,journal_id));
CREATE TABLE accounting.opening_obligations (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, card_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')), opening_journal_id text NOT NULL, payload jsonb NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id), FOREIGN KEY(ledger_id,opening_journal_id) REFERENCES accounting.journals(ledger_id,id));
CREATE TABLE accounting.opening_obligation_evidence (ledger_id uuid NOT NULL REFERENCES public.ledgers(id), obligation_id text NOT NULL, evidence_id text NOT NULL, PRIMARY KEY(ledger_id,obligation_id,evidence_id), FOREIGN KEY(ledger_id,obligation_id) REFERENCES accounting.opening_obligations(ledger_id,id), FOREIGN KEY(ledger_id,evidence_id) REFERENCES accounting.evidence(ledger_id,id));
CREATE TABLE accounting.billings (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, purchase_id text, opening_obligation_id text, card_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')), installment integer NOT NULL CHECK(installment>0), amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991), journal_id text NOT NULL, payload jsonb NOT NULL, CHECK(opening_obligation_id IS NULL OR purchase_id IS NULL), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,purchase_id) REFERENCES accounting.purchases(ledger_id,id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), FOREIGN KEY(ledger_id,opening_obligation_id) REFERENCES accounting.opening_obligations(ledger_id,id), UNIQUE(ledger_id,purchase_id,installment), UNIQUE(ledger_id,opening_obligation_id,installment), UNIQUE(ledger_id,journal_id));
CREATE TABLE accounting.billed_components (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, billing_id text NOT NULL, purpose_id text, minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,billing_id) REFERENCES accounting.billings(ledger_id,id));
CREATE TABLE accounting.payments (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, card_id text NOT NULL, currency text NOT NULL CHECK(currency IN ('ARS','USD')), amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991), journal_id text NOT NULL, payload jsonb NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), UNIQUE(ledger_id,journal_id));
CREATE TABLE accounting.attributions (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, payment_id text NOT NULL, component_id text NOT NULL, purpose_id text, minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991), method text NOT NULL CHECK(method IN ('issuer','oldest_billed_first')), revision integer NOT NULL CHECK(revision>0), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,payment_id) REFERENCES accounting.payments(ledger_id,id), FOREIGN KEY(ledger_id,component_id) REFERENCES accounting.billed_components(ledger_id,id), UNIQUE(ledger_id,payment_id,component_id,revision));
CREATE TABLE accounting.linked_credits (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, purchase_id text NOT NULL, journal_id text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991), payload jsonb NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,purchase_id) REFERENCES accounting.purchases(ledger_id,id), FOREIGN KEY(ledger_id,journal_id) REFERENCES accounting.journals(ledger_id,id), UNIQUE(ledger_id,journal_id));
CREATE TABLE accounting.correction_links (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, purchase_id text NOT NULL, from_version integer NOT NULL, to_version integer NOT NULL, reversal_journal_id text NOT NULL, replacement_journal_id text NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0), recorded_at timestamptz NOT NULL, CHECK(to_version=from_version+1), UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,purchase_id) REFERENCES accounting.purchases(ledger_id,id), FOREIGN KEY(ledger_id,reversal_journal_id) REFERENCES accounting.journals(ledger_id,id), FOREIGN KEY(ledger_id,replacement_journal_id) REFERENCES accounting.journals(ledger_id,id), UNIQUE(ledger_id,purchase_id,to_version), FOREIGN KEY(ledger_id,purchase_id,from_version) REFERENCES accounting.purchase_versions(ledger_id,purchase_id,version), FOREIGN KEY(ledger_id,purchase_id,to_version) REFERENCES accounting.purchase_versions(ledger_id,purchase_id,version));
CREATE TABLE accounting.component_revisions (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, component_id text NOT NULL, billing_id text NOT NULL, revision integer NOT NULL CHECK(revision>0), purpose_id text, minor bigint NOT NULL CHECK(minor BETWEEN 0 AND 9007199254740991), purchase_date date NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,component_id) REFERENCES accounting.billed_components(ledger_id,id), FOREIGN KEY(ledger_id,billing_id) REFERENCES accounting.billings(ledger_id,id), UNIQUE(ledger_id,component_id,revision));
CREATE TABLE accounting.credit_revisions (row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, credit_id text NOT NULL, purchase_version integer NOT NULL CHECK(purchase_version>1), reversal_journal_id text NOT NULL, replacement_journal_id text NOT NULL, recorded_at timestamptz NOT NULL, payload jsonb NOT NULL, UNIQUE(ledger_id,id), UNIQUE(ledger_id,row_id), FOREIGN KEY(ledger_id,credit_id) REFERENCES accounting.linked_credits(ledger_id,id), FOREIGN KEY(ledger_id,reversal_journal_id) REFERENCES accounting.journals(ledger_id,id), FOREIGN KEY(ledger_id,replacement_journal_id) REFERENCES accounting.journals(ledger_id,id), UNIQUE(ledger_id,credit_id,purchase_version));
CREATE TABLE accounting.attribution_revisions (ledger_id uuid NOT NULL REFERENCES public.ledgers(id), payment_id text NOT NULL, revision integer NOT NULL CHECK(revision>0), unapplied_minor bigint NOT NULL CHECK(unapplied_minor BETWEEN 0 AND 9007199254740991), PRIMARY KEY(ledger_id,payment_id,revision), FOREIGN KEY(ledger_id,payment_id) REFERENCES accounting.payments(ledger_id,id));
CREATE TRIGGER cards_immutable BEFORE UPDATE OR DELETE ON accounting.cards FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON accounting.evidence FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER commands_immutable BEFORE UPDATE OR DELETE ON accounting.commands FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER purchases_immutable BEFORE UPDATE OR DELETE ON accounting.purchases FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER purchase_versions_immutable BEFORE UPDATE OR DELETE ON accounting.purchase_versions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER opening_obligations_immutable BEFORE UPDATE OR DELETE ON accounting.opening_obligations FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER opening_obligation_evidence_immutable BEFORE UPDATE OR DELETE ON accounting.opening_obligation_evidence FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER billings_immutable BEFORE UPDATE OR DELETE ON accounting.billings FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER billed_components_immutable BEFORE UPDATE OR DELETE ON accounting.billed_components FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON accounting.payments FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER attributions_immutable BEFORE UPDATE OR DELETE ON accounting.attributions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER linked_credits_immutable BEFORE UPDATE OR DELETE ON accounting.linked_credits FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER correction_links_immutable BEFORE UPDATE OR DELETE ON accounting.correction_links FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER component_revisions_immutable BEFORE UPDATE OR DELETE ON accounting.component_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER credit_revisions_immutable BEFORE UPDATE OR DELETE ON accounting.credit_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER attribution_revisions_immutable BEFORE UPDATE OR DELETE ON accounting.attribution_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();

CREATE INDEX journal_lines_owner_account ON accounting.journal_lines(ledger_id,account_id);
CREATE INDEX journal_evidence_owner_evidence ON accounting.journal_evidence(ledger_id,evidence_id);
CREATE INDEX journals_owner_card ON accounting.journals(ledger_id,card_id);
CREATE INDEX billed_components_owner_billing ON accounting.billed_components(ledger_id,billing_id);
CREATE INDEX attributions_owner_component ON accounting.attributions(ledger_id,component_id);
CREATE FUNCTION accounting.guard_journal_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT status INTO state FROM accounting.journals WHERE ledger_id=OLD.ledger_id AND id=OLD.journal_id FOR UPDATE;
  IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT status INTO state FROM accounting.journals WHERE ledger_id=NEW.ledger_id AND id=NEW.journal_id FOR UPDATE;
 IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF TG_OP='UPDATE' AND NEW.ledger_id<>OLD.ledger_id THEN RAISE EXCEPTION 'immutable_owner'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.journal_lines FOR EACH ROW EXECUTE FUNCTION accounting.guard_journal_child();
CREATE TRIGGER evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.journal_evidence FOR EACH ROW EXECUTE FUNCTION accounting.guard_journal_child();
CREATE FUNCTION accounting.guard_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE count_lines bigint; deb numeric; cred numeric;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
  RETURN OLD;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'journal_requires_draft'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF NEW.ledger_id<>OLD.ledger_id OR NEW.id<>OLD.id OR NEW.row_id<>OLD.row_id THEN RAISE EXCEPTION 'immutable_journal_identity'; END IF;
 IF NEW.status='posted' THEN
  SELECT count(*),sum(debit_minor),sum(credit_minor) INTO count_lines,deb,cred FROM accounting.journal_lines WHERE ledger_id=NEW.ledger_id AND journal_id=NEW.id;
  IF count_lines<2 OR deb IS NULL OR deb<>cred OR deb<=0 OR deb>9007199254740991 THEN RAISE EXCEPTION 'unbalanced_journal'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting.journal_evidence WHERE ledger_id=NEW.ledger_id AND journal_id=NEW.id) THEN RAISE EXCEPTION 'missing_evidence'; END IF;
  IF EXISTS(SELECT 1 FROM accounting.journal_lines l JOIN accounting.accounts a ON a.ledger_id=l.ledger_id AND a.id=l.account_id WHERE l.ledger_id=NEW.ledger_id AND l.journal_id=NEW.id AND (NOT a.enabled OR NOT a.posting OR (a.currency IS NOT NULL AND a.currency<>NEW.currency) OR EXISTS(SELECT 1 FROM accounting.accounts child WHERE child.ledger_id=a.ledger_id AND child.parent_id=a.id))) THEN RAISE EXCEPTION 'invalid_posting_account'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.journals FOR EACH ROW EXECUTE FUNCTION accounting.guard_journal();
CREATE FUNCTION accounting.guard_posted_account_structure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM accounting.journal_lines l JOIN accounting.journals j ON j.ledger_id=l.ledger_id AND j.id=l.journal_id WHERE l.ledger_id=NEW.ledger_id AND l.account_id=NEW.parent_id AND j.status='posted') THEN RAISE EXCEPTION 'posted_account_not_leaf'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM accounting.journal_lines l JOIN accounting.journals j ON j.ledger_id=l.ledger_id AND j.id=l.journal_id WHERE l.ledger_id=OLD.ledger_id AND l.account_id=OLD.id AND j.status='posted') AND (NEW.type IS DISTINCT FROM OLD.type OR NEW.currency IS DISTINCT FROM OLD.currency OR NOT NEW.posting) THEN RAISE EXCEPTION 'posted_account_invariant'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posted_account_structure_guard BEFORE INSERT OR UPDATE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_posted_account_structure();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Owned financial schema rollback requires an explicitly reviewed recovery operation.');
    }
};
