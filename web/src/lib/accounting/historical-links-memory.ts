import {AccountingError} from "./model";
import {currentHistoricalAssociations,latestHistoricalAssociation,type HistoricalLinksTx,type HistoricalReceiptAssociation} from "./historical-links";
export function memoryHistoricalLinksTx(rows:HistoricalReceiptAssociation[]):HistoricalLinksTx {return {
 async historicalAssociations(receiptRevisionId){return structuredClone(rows.filter(r=>receiptRevisionId===undefined||r.receiptRevisionId===receiptRevisionId));},
 async historicalAssociationCommand(key){return structuredClone(rows.find(r=>r.key===key)??null);},
 async appendHistoricalAssociation(row){
  if(rows.some(r=>r.id===row.id||r.key===row.key))throw new AccountingError("historical_association_conflict");
  const previous=latestHistoricalAssociation(rows.filter(r=>r.receiptRevisionId===row.receiptRevisionId));if((previous?.id??null)!==row.previousDecisionId)throw new AccountingError("stale_historical_association");
  if(row.action==="link"&&currentHistoricalAssociations(rows).some(r=>r.sourceLineId===row.sourceLineId&&r.receiptRevisionId!==row.receiptRevisionId))throw new AccountingError("source_charge_already_linked");
  rows.push(structuredClone(row));
 },
};}
