<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE FUNCTION accounting.guard_historical_classification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ledger_id::text,8581401));
 SELECT id INTO latest FROM accounting.review_events WHERE ledger_id=NEW.ledger_id AND subject_id=NEW.subject_id AND code='historical_source_classification' ORDER BY ordinal DESC LIMIT 1;
 IF NEW.prior_decision_id IS DISTINCT FROM latest THEN RAISE EXCEPTION 'stale_review_version'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_classification_chain BEFORE INSERT ON accounting.review_events FOR EACH ROW WHEN (NEW.code='historical_source_classification') EXECUTE FUNCTION accounting.guard_historical_classification();
SQL);
    }

    public function down(): void
    {
        throw new RuntimeException('Historical classification history requires reviewed recovery.');
    }
};
