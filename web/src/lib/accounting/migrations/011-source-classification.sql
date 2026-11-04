ALTER TABLE review_decisions DROP CONSTRAINT review_decisions_kind_check;
ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_kind_check CHECK(kind IN ('product_match','product_update','product_merge','move_code','merchant_merge','alert_state','proposal_accept','proposal_reject','source_classification'));
INSERT INTO schema_migrations(version) VALUES(11);
