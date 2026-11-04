-- Evidence associations preserve historical matching independently of financial recognition.
CREATE TABLE historical_receipt_associations (
 id text PRIMARY KEY,key text NOT NULL UNIQUE,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 receipt_revision_id text NOT NULL REFERENCES receipt_facts(revision_id),
 source_line_id text NOT NULL REFERENCES source_lines(id),card_id text NOT NULL REFERENCES cards(id),
 action text NOT NULL CHECK(action IN ('link','unlink')),
 previous_decision_id text REFERENCES historical_receipt_associations(id),
 recorded_at timestamptz NOT NULL,payload jsonb NOT NULL
);
CREATE INDEX historical_receipt_association_history ON historical_receipt_associations(receipt_revision_id,ordinal);
CREATE FUNCTION guard_historical_receipt_association() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE receipt_amount bigint; source_amount numeric; count_installments integer;
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.previous_decision_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM historical_receipt_associations WHERE receipt_revision_id=NEW.receipt_revision_id) THEN RAISE EXCEPTION 'stale_historical_association'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM historical_receipt_associations WHERE id=NEW.previous_decision_id AND receipt_revision_id=NEW.receipt_revision_id)
    OR EXISTS(SELECT 1 FROM historical_receipt_associations WHERE previous_decision_id=NEW.previous_decision_id) THEN RAISE EXCEPTION 'stale_historical_association'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM receipt_facts f JOIN source_revisions r ON r.id=f.revision_id WHERE f.revision_id=NEW.receipt_revision_id AND r.kind='receipt' AND r.payload->>'admission'='accepted')
    OR NOT EXISTS(SELECT 1 FROM source_lines l JOIN source_revisions r ON r.id=l.revision_id WHERE l.id=NEW.source_line_id AND r.kind='statement' AND r.card_id=NEW.card_id AND r.payload->>'admission'='accepted' AND l.payload->>'section'='purchases') THEN RAISE EXCEPTION 'historical_association_source_unavailable'; END IF;
 SELECT f.total_minor,(l.payload->>'ars')::numeric*100,coalesce((l.payload->>'installment_count')::integer,1) INTO receipt_amount,source_amount,count_installments FROM receipt_facts f CROSS JOIN source_lines l WHERE f.revision_id=NEW.receipt_revision_id AND l.id=NEW.source_line_id;
 IF receipt_amount IS NULL OR receipt_amount<=0 OR source_amount IS NULL OR source_amount<=0 OR source_amount<>round(source_amount) OR count_installments<1
    OR EXISTS(SELECT 1 FROM source_lines l WHERE l.id=NEW.source_line_id AND coalesce((l.payload->>'usd')::numeric,0)<>0)
    OR abs(source_amount*count_installments-receipt_amount)>count_installments*(count_installments-1)::numeric THEN RAISE EXCEPTION 'historical_association_evidence_mismatch'; END IF;
 IF NEW.action='link' AND EXISTS(SELECT 1 FROM historical_receipt_associations d WHERE d.source_line_id=NEW.source_line_id AND d.receipt_revision_id<>NEW.receipt_revision_id AND d.action='link' AND NOT EXISTS(SELECT 1 FROM historical_receipt_associations child WHERE child.previous_decision_id=d.id)) THEN RAISE EXCEPTION 'source_charge_already_linked'; END IF;
 IF NEW.action='unlink' AND NOT EXISTS(SELECT 1 FROM historical_receipt_associations d WHERE d.id=NEW.previous_decision_id AND d.action='link' AND d.source_line_id=NEW.source_line_id) THEN RAISE EXCEPTION 'invalid_historical_association'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_receipt_association_guard BEFORE INSERT ON historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION guard_historical_receipt_association();
CREATE TRIGGER historical_receipt_association_immutable BEFORE UPDATE OR DELETE ON historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(10);
