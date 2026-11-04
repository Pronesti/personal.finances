import {createHash,randomUUID} from "node:crypto";
import {AccountingError} from "./model";
import {validDate} from "./journal";
import {sourceAmountMinor} from "./evidence";
import {amountMatches,MATCH_WINDOW_DAYS} from "../receipts/charges";
import type {LedgerPort,LedgerTx} from "./port";
export type HistoricalReceiptAssociation={id:string;key:string;digest:string;receiptRevisionId:string;sourceLineId:string;cardId:string;currency:"ARS";receiptMinor:number;statementMinor:number;installmentCount:number|null;action:"link"|"unlink";previousDecisionId:string|null;method:"auto"|"manual";recordedAt:string;legacyFingerprint:string|null;provenance:Record<string,unknown>};
export interface HistoricalLinksTx {
 historicalAssociations(receiptRevisionId?:string):Promise<HistoricalReceiptAssociation[]>;
 historicalAssociationCommand(key:string):Promise<HistoricalReceiptAssociation|null>;
 appendHistoricalAssociation(row:HistoricalReceiptAssociation):Promise<void>;
}
export type HistoricalAssociationInput={key:string;receiptRevisionId:string;sourceLineId:string|null;action:"link"|"unlink";expectedPreviousDecisionId:string|null;method:"auto"|"manual";recordedAt:string;legacyFingerprint?:string|null;provenance?:Record<string,unknown>};
export function latestHistoricalAssociation(rows:HistoricalReceiptAssociation[]):HistoricalReceiptAssociation|null {return rows.find(r=>!rows.some(child=>child.previousDecisionId===r.id))??null;}
export function currentHistoricalAssociations(rows:HistoricalReceiptAssociation[]):HistoricalReceiptAssociation[] {return [...new Set(rows.map(r=>r.receiptRevisionId))].map(id=>latestHistoricalAssociation(rows.filter(r=>r.receiptRevisionId===id))).filter((r):r is HistoricalReceiptAssociation=>r!==null&&r.action==="link");}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export async function recordHistoricalAssociation(port:LedgerPort,input:HistoricalAssociationInput):Promise<HistoricalReceiptAssociation> {return port.transaction(tx=>recordHistoricalAssociationTx(tx,input));}
export async function recordHistoricalAssociationTx(tx:LedgerTx,input:HistoricalAssociationInput):Promise<HistoricalReceiptAssociation> {
 if(!input.key?.trim()||!input.receiptRevisionId?.trim()||!["link","unlink"].includes(input.action)||!["auto","manual"].includes(input.method)||!validDate(input.recordedAt.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt)||!Number.isFinite(Date.parse(input.recordedAt)))throw new AccountingError("invalid_historical_association");
 const key=`historical-association:${encodeURIComponent(input.key)}`,digest=createHash("sha256").update(JSON.stringify(canonical({...input,recordedAt:undefined}))).digest("hex"),saved=await tx.historicalAssociationCommand(key);
 if(saved){if(saved.digest!==digest)throw new AccountingError("command_conflict");return saved;}
 const all=await tx.historicalAssociations(),previous=latestHistoricalAssociation(all.filter(r=>r.receiptRevisionId===input.receiptRevisionId));
 if((previous?.id??null)!==input.expectedPreviousDecisionId)throw new AccountingError("stale_historical_association");
 const sourceLineId=input.sourceLineId??(input.action==="unlink"?previous?.sourceLineId:null);
 if(!sourceLineId||input.action==="unlink"&&(!previous||previous.action!=="link"||sourceLineId!==previous.sourceLineId))throw new AccountingError("invalid_historical_association");
 const receipt=await tx.receiptFacts(input.receiptRevisionId),receiptSource=await tx.sourceRevision(input.receiptRevisionId),line=await tx.sourceLine(sourceLineId),statement=line?await tx.sourceRevision(line.revisionId):null;
 if(!receipt||receiptSource?.kind!=="receipt"||receiptSource.admission!=="accepted"||!receipt.report.ok||!receipt.date||!Number.isSafeInteger(receipt.totalMinor)||receipt.totalMinor!<=0||statement?.kind!=="statement"||statement.admission!=="accepted"||!statement.cardId||!line)throw new AccountingError("historical_association_source_unavailable");
 const p=line.payload;
 if(p.section!=="purchases"||typeof p.ars!=="number"||p.ars<=0||p.usd!==undefined&&p.usd!==null&&p.usd!==0||typeof p.date!=="string"||!validDate(p.date)||!validDate(receipt.date))throw new AccountingError("historical_association_currency_or_amount");
 const statementMinor=sourceAmountMinor(p.ars),installmentCount=typeof p.installment_count==="number"?p.installment_count:null;
 if(installmentCount!==null&&(!Number.isSafeInteger(installmentCount)||installmentCount<1)||p.installment_number!==null&&p.installment_number!==undefined&&p.installment_number!==1||!amountMatches(p.ars,installmentCount,receipt.totalMinor!)||Math.abs(Date.parse(p.date)-Date.parse(receipt.date))/86400000>MATCH_WINDOW_DAYS)throw new AccountingError("historical_association_evidence_mismatch");
 if(input.legacyFingerprint!==undefined&&input.legacyFingerprint!==null&&input.legacyFingerprint!==line.legacyFingerprint)throw new AccountingError("historical_association_fingerprint_mismatch");
 if(input.action==="link"&&currentHistoricalAssociations(all).some(r=>r.sourceLineId===sourceLineId&&r.receiptRevisionId!==input.receiptRevisionId))throw new AccountingError("source_charge_already_linked");
 if(input.action==="link") {
  const decisions=await tx.allReceiptLinkDecisions(),current=decisions.filter(r=>r.action==="link"&&!decisions.some(child=>child.previousDecisionId===r.id));
  const identities=(await tx.allPurchaseIdentities()).filter(identity=>identity.sourceLineId===sourceLineId&&identity.currency==="ARS");
  const purchases=new Set(identities.map(identity=>identity.purchaseId));
  if(current.some(r=>r.receiptRevisionId===input.receiptRevisionId&&(!r.purchaseId||!purchases.has(r.purchaseId))))throw new AccountingError("receipt_has_financial_link");
  if(current.some(r=>r.receiptRevisionId!==input.receiptRevisionId&&r.purchaseId&&purchases.has(r.purchaseId)))throw new AccountingError("source_charge_already_linked");
 }
 const row:HistoricalReceiptAssociation={id:randomUUID(),key,digest,receiptRevisionId:input.receiptRevisionId,sourceLineId,cardId:statement.cardId,currency:"ARS",receiptMinor:receipt.totalMinor!,statementMinor,installmentCount,action:input.action,previousDecisionId:previous?.id??null,method:input.method,recordedAt:input.recordedAt,legacyFingerprint:input.legacyFingerprint??null,provenance:input.provenance??{}};
 await tx.appendHistoricalAssociation(row);return row;
}
