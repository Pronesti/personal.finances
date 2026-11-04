import {randomUUID} from "node:crypto";
import {currentHistoricalAssociations} from "./historical-links";
import {verify} from "../receipts/verify";
import {validDate} from "./journal";
import {normalizeMerchant} from "../categorize";
import {eligibleHistoricalSource} from "./historical-analytics";
import {AccountingError} from "./model";
import {purposeGroups} from "./catalog";
import type {LedgerTx} from "./port";
import type {MerchantSubject,RuleSubject} from "./review";
export const HISTORICAL_CLASSIFICATION_CODE="historical_source_classification";
async function eligible(tx:LedgerTx,cardId:string){
 const identities=await tx.allPurchaseIdentities(),merchants=await tx.reviewSubjects("merchant") as MerchantSubject[],rows=[],associations=currentHistoricalAssociations(await tx.historicalAssociations()),acceptedReceipts=await tx.acceptedReceipts(),currentReceipts=new Map(acceptedReceipts.map(receipt=>[receipt.receiptId,receipt]));
 for(const {line,revision} of await tx.statementSourceLines(cardId)){
  if(identities.some(identity=>identity.sourceLineId===line.id))continue;
  // The shared reader predicate validates source nature, one currency, one-off and opening boundary.
  const payload=line.payload,currency=typeof payload.ars==="number"&&payload.ars!==0?"ARS":"USD";
  const opening=await tx.openingDate(cardId,currency)??await tx.openingDate(cardId,currency==="ARS"?"USD":"ARS");
  const supportedReceipts=[];
  for(const association of associations.filter(row=>row.sourceLineId===line.id)){
   const receipt=acceptedReceipts.find(row=>row.revisionId===association.receiptRevisionId),source=receipt?await tx.sourceRevision(receipt.revisionId):null;
   if(!receipt||currentReceipts.get(receipt.receiptId)?.revisionId!==receipt.revisionId||source?.kind!=="receipt"||source.admission!=="accepted"||!receipt.report.ok||!verify(receipt.parsed).ok||!receipt.date||!validDate(receipt.date)||!opening||receipt.date>opening||!Number.isSafeInteger(receipt.totalMinor)||receipt.totalMinor!<=0||association.receiptMinor!==receipt.totalMinor)continue;
   supportedReceipts.push(receipt);
  }
  const receiptPrincipal=supportedReceipts.length===1?supportedReceipts[0].totalMinor!:undefined;
  if(!eligibleHistoricalSource(line,revision,opening,receiptPrincipal))continue;
  const raw=normalizeMerchant(String(payload.description)),alias=merchants.filter(m=>m.redirectId&&raw.toUpperCase().startsWith(m.normalizedName)).sort((a,b)=>b.normalizedName.length-a.normalizedName.length)[0];
  let merchant:MerchantSubject|undefined=alias;const seen=new Set<string>();while(merchant?.redirectId&&!seen.has(merchant.id)){seen.add(merchant.id);merchant=merchants.find(m=>m.id===merchant!.redirectId);}
  rows.push({sourceLineId:line.id,merchant:merchant?.displayName??merchant?.normalizedName??raw});
 }
 return rows;
}
export async function previewSourceClassificationTx(tx:LedgerTx,input:{sourceLineId:string;match:string}):Promise<{sourceLineId:string;merchant:string}[]>{
 const line=await tx.sourceLine(input.sourceLineId),revision=line?await tx.sourceRevision(line.revisionId):null;if(!revision?.cardId)throw new AccountingError("missing_historical_acquisition");
 const match=input.match.trim().toUpperCase();if(match.length<3)throw new AccountingError("invalid_rule_match");
 return (await eligible(tx,revision.cardId)).filter(row=>row.merchant.toUpperCase().includes(match)).sort((a,b)=>a.sourceLineId.localeCompare(b.sourceLineId));
}
export async function applySourceClassificationTx(tx:LedgerTx,input:{sourceLineId:string;payload:Record<string,unknown>;recordedAt:string}):Promise<string[]>{
 const p=input.payload,scope=String(p.scope??"selected"),accountId=String(p.accountId??""),purposeId=String(p.purposeId??""),target=await tx.account(accountId);
 if(!["selected","future_rule","matching_history"].includes(scope))throw new AccountingError("invalid_classification_scope");
 if(!target||!target.enabled||!target.posting||!["expense","asset"].includes(target.type)||await tx.hasChildAccounts(target.id))throw new AccountingError("invalid_posting_account");
 if(!["unallocated",...purposeGroups().map(group=>group.id)].includes(purposeId)||target.primaryPurposeId!==null&&target.primaryPurposeId!==purposeId)throw new AccountingError("invalid_primary_purpose");
 const line=await tx.sourceLine(input.sourceLineId),revision=line?await tx.sourceRevision(line.revisionId):null;if(!revision?.cardId)throw new AccountingError("missing_historical_acquisition");
 const candidates=await eligible(tx,revision.cardId);if(!candidates.some(row=>row.sourceLineId===input.sourceLineId))throw new AccountingError("missing_historical_acquisition");
 const match=scope==="selected"?"":String(p.match??"").trim().toUpperCase();if(scope!=="selected"&&match.length<3)throw new AccountingError("invalid_rule_match");
 let ids=[input.sourceLineId];
 if(scope==="matching_history"){
  ids=candidates.filter(row=>row.merchant.toUpperCase().includes(match)).map(row=>row.sourceLineId).sort();
  const confirmed=Array.isArray(p.confirmedSourceLineIds)&&p.confirmedSourceLineIds.every(id=>typeof id==="string")?[...new Set(p.confirmedSourceLineIds as string[])].sort():[];
  if(p.confirmHistory!==true||!ids.length||JSON.stringify(ids)!==JSON.stringify(confirmed))throw new AccountingError("history_confirmation_required");
 }
 if(scope!=="selected"){
  const rules=await tx.reviewSubjects("rule") as RuleSubject[],owned=rules.find(rule=>rule.enabled&&rule.match===match),id=owned?.id??randomUUID();let position=1;
  for(const rule of rules.filter(rule=>rule.id!==id).sort((a,b)=>a.position-b.position))await tx.appendReviewSubject({...rule,position:position++});
  await tx.appendReviewSubject({kind:"rule",id,match,accountId,purposeId,position:0,enabled:true});
 }
 if(scope==="future_rule")return [];
 for(const sourceLineId of ids){
  const events=(await tx.reviewEvents(sourceLineId)).filter(event=>event.code===HISTORICAL_CLASSIFICATION_CODE),previous=events.find(event=>!events.some(child=>child.priorDecisionId===event.id));
  await tx.appendReviewEvent({id:randomUUID(),subjectId:sourceLineId,code:HISTORICAL_CLASSIFICATION_CODE,params:{accountId,purposeId,scope,match},sourceLineIds:[sourceLineId],priorDecisionId:previous?.id??null,state:"reviewed",recordedAt:input.recordedAt});
 }
 return ids;
}
