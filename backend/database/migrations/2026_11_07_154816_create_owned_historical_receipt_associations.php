<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.historical_receipt_associations (
 row_id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES public.ledgers(id), id text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 key text NOT NULL, digest text NOT NULL, receipt_id bigint NOT NULL, receipt_revision_id text NOT NULL, source_line_id text NOT NULL, card_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('link','unlink')), previous_decision_id text, recorded_at timestamptz NOT NULL, payload jsonb NOT NULL,
 UNIQUE(ledger_id,id), UNIQUE(ledger_id,key), UNIQUE(ledger_id,row_id),
 FOREIGN KEY(ledger_id,receipt_id,receipt_revision_id) REFERENCES accounting.receipt_facts(ledger_id,receipt_id,revision_id),
 FOREIGN KEY(ledger_id,source_line_id) REFERENCES accounting.source_lines(ledger_id,id), FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id),
 FOREIGN KEY(ledger_id,previous_decision_id) REFERENCES accounting.historical_receipt_associations(ledger_id,id)
);
CREATE INDEX historical_receipt_owner_history ON accounting.historical_receipt_associations(ledger_id,receipt_id,ordinal);
CREATE INDEX historical_source_owner_history ON accounting.historical_receipt_associations(ledger_id,source_line_id,ordinal);
CREATE FUNCTION accounting.guard_historical_association() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 IF NEW.previous_decision_id IS DISTINCT FROM (SELECT id FROM accounting.historical_receipt_associations WHERE ledger_id=NEW.ledger_id AND receipt_id=NEW.receipt_id ORDER BY ordinal DESC LIMIT 1) THEN RAISE EXCEPTION 'stale_historical_association'; END IF;
 IF NEW.action='link' AND EXISTS(SELECT 1 FROM accounting.historical_receipt_associations d WHERE d.ledger_id=NEW.ledger_id AND d.source_line_id=NEW.source_line_id AND d.receipt_id<>NEW.receipt_id AND d.action='link' AND NOT EXISTS(SELECT 1 FROM accounting.historical_receipt_associations c WHERE c.ledger_id=d.ledger_id AND c.previous_decision_id=d.id)) THEN RAISE EXCEPTION 'source_charge_already_linked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting.source_lines l JOIN accounting.source_revisions s ON s.ledger_id=l.ledger_id AND s.id=l.revision_id WHERE l.ledger_id=NEW.ledger_id AND l.id=NEW.source_line_id AND s.card_id=NEW.card_id) THEN RAISE EXCEPTION 'historical_source_card_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_association_guard BEFORE INSERT ON accounting.historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION accounting.guard_historical_association();
CREATE TRIGGER historical_associations_immutable BEFORE UPDATE OR DELETE ON accounting.historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Historical evidence rollback requires reviewed recovery.');
    }
};
