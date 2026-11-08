<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.proposal_revisions (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), seq bigint GENERATED ALWAYS AS IDENTITY,
 id text NOT NULL,merchant_id text NOT NULL,prior_row_id uuid,state text NOT NULL CHECK(state IN ('pending','accepted','rejected')),
 payload jsonb NOT NULL,UNIQUE(ledger_id,row_id),
 FOREIGN KEY(ledger_id,merchant_id) REFERENCES accounting.merchant_entities(ledger_id,id),
 FOREIGN KEY(ledger_id,prior_row_id) REFERENCES accounting.proposal_revisions(ledger_id,row_id)
);
CREATE UNIQUE INDEX proposal_root ON accounting.proposal_revisions(ledger_id,id) WHERE prior_row_id IS NULL;
CREATE UNIQUE INDEX proposal_child ON accounting.proposal_revisions(ledger_id,prior_row_id) WHERE prior_row_id IS NOT NULL;
CREATE INDEX proposal_current ON accounting.proposal_revisions(ledger_id,id,seq);
CREATE TRIGGER proposals_immutable BEFORE UPDATE OR DELETE ON accounting.proposal_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE FUNCTION accounting.proposal_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.prior_row_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting.proposal_revisions p WHERE p.ledger_id=NEW.ledger_id AND p.row_id=NEW.prior_row_id AND p.id=NEW.id AND p.merchant_id=NEW.merchant_id AND p.state='pending') THEN RAISE EXCEPTION 'invalid proposal ancestry'; END IF;
 IF (NEW.prior_row_id IS NULL AND NEW.state<>'pending') OR (NEW.prior_row_id IS NOT NULL AND NEW.state='pending') THEN RAISE EXCEPTION 'invalid proposal transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_ancestry BEFORE INSERT ON accounting.proposal_revisions FOR EACH ROW EXECUTE FUNCTION accounting.proposal_chain();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Proposal history requires reviewed recovery.');
    }
};
