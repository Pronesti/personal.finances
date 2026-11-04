import {postgresHistoricalLinksTx} from "./historical-links-postgres";
import type { PoolClient } from "pg";
import { AccountingError } from "./model";
import type { EvidenceTx, SourceRevision, SourceLine, ReviewEvent, ImportResult, ReceiptFacts, ReceiptLinkDecision } from "./evidence-port";
import type { PurchaseIdentity } from "./evidence";

/** Uses the caller's client/transaction/search path; never starts an independent commit. */
export function postgresEvidenceTx(client: PoolClient): EvidenceTx {
  return {
    ...postgresHistoricalLinksTx(client),
    async sourceObject(hash) {
      const r = await client.query('SELECT sha256,relative_path AS "relativePath",byte_length::text AS size FROM source_documents WHERE sha256=$1', [hash]);
      if (!r.rows[0]) return null;
      const byteLength = Number(r.rows[0].size);
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new AccountingError("invalid_source_object");
      return { sha256: r.rows[0].sha256, relativePath: r.rows[0].relativePath, byteLength };
    },
    async appendSourceObject(o) {
      await client.query("INSERT INTO source_documents(sha256,relative_path,byte_length) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [o.sha256,o.relativePath,o.byteLength]);
      const r = await client.query("SELECT 1 FROM source_documents WHERE sha256=$1 AND relative_path=$2 AND byte_length=$3", [o.sha256,o.relativePath,o.byteLength]);
      if (!r.rowCount) throw new AccountingError("source_object_conflict");
    },
    async sourceRevision(id) { const r = await client.query("SELECT payload FROM source_revisions WHERE id=$1", [id]); return r.rows[0]?.payload as SourceRevision ?? null; },
    async sourceRevisions(key) { const r = await client.query("SELECT payload FROM source_revisions WHERE source_key=$1 ORDER BY ordinal", [key]); return r.rows.map(r => r.payload as SourceRevision); },
    async sourceByDocument(kind,hash,payloadDigest) { const r = await client.query("SELECT payload FROM source_revisions WHERE kind=$1 AND document_hash=$2 AND ($3::text IS NULL OR payload_digest=$3) ORDER BY ordinal DESC LIMIT 1", [kind,hash,payloadDigest??null]); return r.rows[0]?.payload as SourceRevision ?? null; },
    async appendSourceRevision(r) {
      await client.query("INSERT INTO evidence(id,kind,metadata) VALUES($1,$2,$3)", [r.id,r.kind,{documentHash:r.documentHash,sourceKey:r.sourceKey}]);
      await client.query("INSERT INTO source_revisions(id,source_key,kind,card_id,document_hash,raw_object_hash,previous_revision_id,recorded_at,app_revision,payload,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [r.id,r.sourceKey,r.kind,r.cardId,r.documentHash,r.rawObject?.sha256 ?? null,r.previousRevisionId,r.recordedAt,r.appRevision,r,r.payloadDigest]);
    },
    async sourceLine(id) {const r=await client.query('SELECT id,revision_id AS "revisionId",occurrence,payload,legacy_fingerprint AS "legacyFingerprint" FROM source_lines WHERE id=$1',[id]);return r.rows[0] as SourceLine??null;},
    async sourceLines(id) { const r = await client.query('SELECT id,revision_id AS "revisionId",occurrence,payload,legacy_fingerprint AS "legacyFingerprint" FROM source_lines WHERE revision_id=$1 ORDER BY occurrence', [id]); return r.rows as SourceLine[]; },
    async appendSourceLine(l) {
      const r = await client.query("SELECT kind FROM source_revisions WHERE id=$1", [l.revisionId]);
      if (!r.rows[0]) throw new AccountingError("missing_source_revision");
      await client.query("INSERT INTO evidence(id,kind,metadata) VALUES($1,$2,$3)", [l.id,r.rows[0].kind,{revisionId:l.revisionId,occurrence:l.occurrence}]);
      await client.query("INSERT INTO source_lines(id,revision_id,occurrence,payload,legacy_fingerprint) VALUES($1,$2,$3,$4,$5)", [l.id,l.revisionId,l.occurrence,l.payload,l.legacyFingerprint]);
    },
    async statementSourceLines(cardId) {
      const r=await client.query("SELECT r.payload AS revision,jsonb_build_object('id',l.id,'revisionId',l.revision_id,'occurrence',l.occurrence,'payload',l.payload,'legacyFingerprint',l.legacy_fingerprint) AS line FROM source_revisions r JOIN source_lines l ON l.revision_id=r.id WHERE r.kind='statement' AND r.payload->>'admission'='accepted' AND ($1::text IS NULL OR r.card_id=$1) AND NOT EXISTS(SELECT 1 FROM source_revisions newer WHERE newer.source_key=r.source_key AND newer.ordinal>r.ordinal AND newer.payload->>'admission'='accepted') ORDER BY r.ordinal,l.occurrence",[cardId]);
      return r.rows;
    },
    async statementFacts(id) {
      const cycle=await client.query('SELECT revision_id AS "revisionId",card_id AS "cardId",closing_date::text AS "closingDate",period FROM statement_cycles WHERE revision_id=$1',[id]);
      if (!cycle.rows[0]) return null;
      const terms=await client.query("SELECT payload FROM statement_terms WHERE revision_id=$1",[id]);
      const schedules=await client.query("SELECT payload FROM issuer_schedules WHERE revision_id=$1 ORDER BY ordinal",[id]);
      return {...cycle.rows[0],terms:terms.rows[0]?.payload??null,schedules:schedules.rows.map(r=>r.payload)};
    },
    async currentStatementRevision(cardId, closingDate) { const r=await client.query("SELECT payload FROM source_revisions WHERE kind='statement' AND card_id=$1 AND payload->>'admission'='accepted' AND ($2::text IS NULL OR payload->>'closingDate'=$2) ORDER BY (payload->>'closingDate') DESC,ordinal DESC LIMIT 1",[cardId,closingDate??null]); return r.rows[0]?.payload as SourceRevision??null; },
    async appendStatementFacts(f) {
      await client.query("INSERT INTO statement_cycles(revision_id,card_id,closing_date,period) VALUES($1,$2,$3,$4)", [f.revisionId,f.cardId,f.closingDate,f.period]);
      await client.query("INSERT INTO statement_terms(revision_id,payload) VALUES($1,$2)", [f.revisionId,f.terms]);
      for (let i=0;i<f.schedules.length;i++) await client.query("INSERT INTO issuer_schedules(revision_id,ordinal,payload) VALUES($1,$2,$3)", [f.revisionId,i+1,f.schedules[i]]);
    },
    async reviewEvents(id) { const r = await client.query('SELECT id,subject_id AS "subjectId",prior_decision_id AS "priorDecisionId",code,params,source_line_ids AS "sourceLineIds",state,recorded_at FROM review_events WHERE subject_id=$1 ORDER BY ordinal', [id]); return r.rows.map(r=>({...r,recordedAt:r.recorded_at.toISOString(),recorded_at:undefined})) as ReviewEvent[]; },
    async appendReviewEvent(e) { await client.query("INSERT INTO review_events(id,subject_id,prior_decision_id,code,params,source_line_ids,state,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [e.id,e.subjectId,e.priorDecisionId,e.code,e.params,JSON.stringify(e.sourceLineIds),e.state,e.recordedAt]); },
    async purchaseIdentities(card,currency,date) { const r = await client.query("SELECT payload FROM source_purchase_identities WHERE card_id=$1 AND currency=$2 AND purchase_date=$3", [card,currency,date]); return r.rows.map(r=>r.payload as PurchaseIdentity); },
    async appendPurchaseIdentity(p) { await client.query("INSERT INTO source_purchase_identities(source_line_id,currency,purchase_id,card_id,purchase_date,payload) VALUES($1,$2,$3,$4,$5,$6)", [p.sourceLineId,p.currency,p.purchaseId,p.cardId,p.purchaseDate,p]); },
    async allPurchaseIdentities() { const r=await client.query("SELECT payload FROM source_purchase_identities"); return r.rows.map(r=>r.payload as PurchaseIdentity); },
    async ensureReceiptEntity(chain,fiscalId,documentHash,previousReceiptId) {
      const keys=[`sha256:${documentHash}`,...(fiscalId?[`fiscal:${fiscalId}`]:[])];
      const aliases=await client.query("SELECT DISTINCT receipt_id::text AS id FROM receipt_entity_keys WHERE chain=$1 AND identity_key=ANY($2::text[])",[chain,keys]);
      const ids=aliases.rows.map(r=>Number(r.id));
      if(ids.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(ids).size>1 || previousReceiptId!==undefined && ids.some(id=>id!==previousReceiptId)) throw new AccountingError("receipt_entity_conflict");
      let id=ids[0]??previousReceiptId;
      if(id===undefined) {const inserted=await client.query("INSERT INTO receipt_entities(chain,fiscal_id) VALUES($1,$2) RETURNING id::text",[chain,fiscalId]);id=Number(inserted.rows[0].id);}
      if(!Number.isSafeInteger(id)||id<1) throw new AccountingError("invalid_receipt_entity");
      const entity=await client.query("SELECT chain,fiscal_id FROM receipt_entities WHERE id=$1 FOR UPDATE",[id]);
      if(!entity.rows[0] || entity.rows[0].chain!==chain) throw new AccountingError("missing_receipt_entity");
      if(fiscalId!==null && entity.rows[0].fiscal_id!==null && entity.rows[0].fiscal_id!==fiscalId) throw new AccountingError("receipt_entity_conflict");
      if(fiscalId!==null && entity.rows[0].fiscal_id===null) await client.query("UPDATE receipt_entities SET fiscal_id=$2 WHERE id=$1",[id,fiscalId]);
      for(const key of keys) await client.query("INSERT INTO receipt_entity_keys(chain,identity_key,receipt_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[chain,key,id]);
      return id;
    },
    async receiptFacts(id) { const r=await client.query("SELECT payload FROM receipt_facts WHERE revision_id=$1",[id]); return r.rows[0]?.payload as ReceiptFacts??null; },
    async appendReceiptFacts(f) { await client.query("INSERT INTO receipt_facts(revision_id,receipt_id,chain,fiscal_id,receipt_date,total_minor,original_rows_hash,corrected_rows_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[f.revisionId,f.receiptId,f.chain,f.fiscalId,f.date,f.totalMinor,f.originalRowsObject.sha256,f.correctedRowsObject?.sha256??null,f]); },
    async acceptedReceipts() { const r=await client.query("SELECT f.payload FROM receipt_facts f JOIN source_revisions r ON r.id=f.revision_id WHERE r.payload->>'admission'='accepted'"); return r.rows.map(r=>r.payload as ReceiptFacts); },
    async receiptLinkDecisions(id) { const r=await client.query("SELECT payload FROM receipt_link_decisions WHERE receipt_revision_id=$1 ORDER BY ordinal",[id]); return r.rows.map(r=>r.payload as ReceiptLinkDecision); },
    async allReceiptLinkDecisions() { const r=await client.query("SELECT payload FROM receipt_link_decisions ORDER BY ordinal"); return r.rows.map(r=>r.payload as ReceiptLinkDecision); },
    async appendReceiptLinkDecision(d) { await client.query("INSERT INTO receipt_link_decisions(id,key,receipt_revision_id,purchase_id,card_id,action,previous_decision_id,recorded_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[d.id,d.key,d.receiptRevisionId,d.purchaseId,d.cardId,d.action,d.previousDecisionId,d.recordedAt,d]); },
    async sourceImportCommand(key) { const r = await client.query("SELECT key,digest,result FROM source_import_commands WHERE key=$1", [key]); return r.rows[0] as {key:string;digest:string;result:ImportResult} ?? null; },
    async appendSourceImportCommand(c) { await client.query("INSERT INTO source_import_commands(key,digest,result) VALUES($1,$2,$3)", [c.key,c.digest,c.result]); },
  };
}
