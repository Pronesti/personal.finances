import type {PoolClient} from "pg";
import type {HistoricalLinksTx,HistoricalReceiptAssociation} from "./historical-links";
export function postgresHistoricalLinksTx(client:PoolClient):HistoricalLinksTx {return {
 async historicalAssociations(receiptRevisionId){return (await client.query(`SELECT payload FROM historical_receipt_associations ${receiptRevisionId===undefined?"":"WHERE receipt_revision_id=$1"} ORDER BY ordinal`,receiptRevisionId===undefined?[]:[receiptRevisionId])).rows.map(r=>r.payload as HistoricalReceiptAssociation);},
 async historicalAssociationCommand(key){return (await client.query("SELECT payload FROM historical_receipt_associations WHERE key=$1",[key])).rows[0]?.payload??null;},
 async appendHistoricalAssociation(r){await client.query("INSERT INTO historical_receipt_associations(id,key,digest,receipt_revision_id,source_line_id,card_id,action,previous_decision_id,recorded_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[r.id,r.key,r.digest,r.receiptRevisionId,r.sourceLineId,r.cardId,r.action,r.previousDecisionId,r.recordedAt,r]);},
};}
