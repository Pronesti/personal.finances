import type {PoolClient} from "pg";
import type {ReviewTx,ReviewSubject,ReviewDecision} from "./review";
import {AccountingError} from "./model";
const tables:Record<ReviewSubject["kind"],string>={product:"product_revisions",code:"product_code_revisions",match:"product_match_revisions",merchant:"merchant_revisions",merchant_purchase:"merchant_purchase_revisions",rule:"merchant_rule_revisions",product_rule:"product_rule_revisions",proposal:"proposal_revisions",alert:"alert_state_revisions",rejection:"merchant_rejections"};
export function postgresReviewTx(client:PoolClient):ReviewTx{return {
 async nextProductId(){const r=await client.query("INSERT INTO review_products DEFAULT VALUES RETURNING id::text");const id=r.rows[0].id;if(!Number.isSafeInteger(Number(id)))throw new AccountingError("invalid_product_id");return id;},
 async reviewSubject(kind,id){return (await client.query(`SELECT payload FROM ${tables[kind]} WHERE ${kind==="product"?"product_id":"id"}=$1 ORDER BY seq DESC LIMIT 1`,[id])).rows[0]?.payload??null;},
 async reviewSubjects(kind){const column=kind==="product"?"product_id":"id";return (await client.query(`SELECT DISTINCT ON (${column}) payload FROM ${tables[kind]} ORDER BY ${column},seq DESC`)).rows.map(r=>r.payload as ReviewSubject);},
 async appendReviewSubject(s){await client.query(`INSERT INTO ${tables[s.kind]}(${s.kind==="product"?"product_id":"id"},payload) VALUES($1,$2)`,[s.id,s]);},
 async reviewDecisions(id){return (await client.query('SELECT id,key,digest,subject_id AS "subjectId",kind,payload,prior_decision_id AS "priorDecisionId",recorded_at AS "recordedAt",affected_ids AS "affectedIds" FROM review_decisions WHERE subject_id=$1 ORDER BY seq',[id])).rows.map(r=>({...r,recordedAt:r.recordedAt.toISOString()} as ReviewDecision));},
 async reviewCommand(key){const r=(await client.query('SELECT id,key,digest,subject_id AS "subjectId",kind,payload,prior_decision_id AS "priorDecisionId",recorded_at AS "recordedAt",affected_ids AS "affectedIds" FROM review_decisions WHERE key=$1',[key])).rows[0];return r?{...r,recordedAt:r.recordedAt.toISOString()}:null;},
 async appendReview(r){await client.query("INSERT INTO review_decisions(id,key,digest,subject_id,kind,payload,prior_decision_id,recorded_at,affected_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[r.id,r.key,r.digest,r.subjectId,r.kind,r.payload,r.priorDecisionId,r.recordedAt,JSON.stringify(r.affectedIds)]);},
};}
