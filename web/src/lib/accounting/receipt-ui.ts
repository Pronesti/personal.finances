import type { AccountingContext } from "@/lib/backend";
import type { ReceiptSummary } from "@/lib/receipts/queries";
import type { ChargeRef, ReceiptSide } from "@/lib/receipts/charges";
import { sourceLineId } from "./evidence";
import type { LedgerPort, LedgerTx } from "./port";
import type { ReceiptFacts, SourceRevision } from "./evidence-port";
import type { ProductSubject, MatchSubject, CodeSubject } from "./review";
import {amountMatches} from "@/lib/receipts/charges";
import {sourceAmountMinor} from "./evidence";
import {currentHistoricalAssociations,latestHistoricalAssociation} from "./historical-links";
import { latestReceiptDecision } from "./linking";
export async function currentReceiptsTx(tx:LedgerTx):Promise<ReceiptFacts[]> {
  const byId=new Map<number,ReceiptFacts>();for(const r of await tx.acceptedReceipts())byId.set(r.receiptId,r);return [...byId.values()];
}
export function receiptSummary(f:ReceiptFacts):ReceiptSummary {
  return {id:f.receiptId,date:f.date!,time:f.parsed.header.time,branch_name:f.parsed.header.branchName,items:f.parsed.items.length,subtotal_cents:f.parsed.footer.subtotalCents!,discounts_cents:f.parsed.footer.discountsCents!,total_cents:f.totalMinor!,transcript_source:f.correctedRowsObject?"corrected":"ocr"};
}
export async function accountingReceiptList(ledger:LedgerPort):Promise<ReceiptSummary[]> {return ledger.transaction(async tx=>(await currentReceiptsTx(tx)).map(receiptSummary).sort((a,b)=>b.date.localeCompare(a.date)||(b.time??"").localeCompare(a.time??"")||b.id-a.id));}
export async function receiptRevisionForId(tx:LedgerTx,id:number,requested?:string):Promise<ReceiptFacts|null>{
  if(requested){const facts=await tx.receiptFacts(requested),revision=await tx.sourceRevision(requested);return facts?.receiptId===id&&revision?.admission==="accepted"?facts:null;}
  return (await currentReceiptsTx(tx)).find(r=>r.receiptId===id)??null;
}
export const HISTORICAL_CHARGE_PREFIX="historical-source:";
export function historicalSourceLineId(fingerprint:string):string|null {return fingerprint.startsWith(HISTORICAL_CHARGE_PREFIX)?fingerprint.slice(HISTORICAL_CHARGE_PREFIX.length):null;}
export async function accountingHistoricalChargesTx(tx:LedgerTx):Promise<ChargeRef[]> {
 const identities=await tx.allPurchaseIdentities(),rows:ChargeRef[]=[];
 for(const {line,revision} of await tx.statementSourceLines(null)){
  const p=line.payload;if(identities.some(identity=>identity.sourceLineId===line.id)||p.section!=="purchases"||!/COTO/i.test(String(p.description??""))||typeof p.ars!=="number"||p.ars<=0||p.usd!==undefined&&p.usd!==null&&p.usd!==0||typeof p.date!=="string"||p.installment_number!==null&&p.installment_number!==undefined&&p.installment_number!==1)continue;
  const count=typeof p.installment_count==="number"?p.installment_count:null,minor=sourceAmountMinor(p.ars);
  rows.push({fingerprint:HISTORICAL_CHARGE_PREFIX+line.id,brand:revision.cardId!,date:p.date,description:String(p.description),merchant:"COTO",ars:p.ars,installment_number:typeof p.installment_number==="number"?p.installment_number:null,installment_count:count,cycle_month:revision.closingDate?.slice(0,7)??p.date.slice(0,7),statement_file:String((revision.rawPayload as {file?:string}).file??""),purchaseCents:minor*(count&&count>1?count:1)});
 }
 return rows;
}
export async function accountingReceiptSideTx(tx:LedgerTx,f:ReceiptFacts):Promise<ReceiptSide & {historicalAssociationId:string|null;historical:boolean}> {
  const identities=await tx.allPurchaseIdentities(),allLinks=await tx.allReceiptLinkDecisions(),history=await tx.receiptLinkDecisions(f.revisionId),link=latestReceiptDecision(history);
  const refs=new Map<string,ChargeRef>();
  for(const i of identities) {
    if(i.currency!=="ARS")continue;const source=await tx.sourceLine(i.sourceLineId);if(!source||!/COTO/i.test(String(source.payload.description??"")))continue;
    const p=await tx.purchase(i.purchaseId),revision=await tx.sourceRevision(source.revisionId);if(!p||!revision?.closingDate)continue;
    refs.set(p.purchaseId,{fingerprint:p.purchaseId,brand:p.cardId,date:p.effectiveDate,description:String(source.payload.description),merchant:"COTO",ars:i.amountMinor/100,installment_number:i.installment,installment_count:i.installmentCount,cycle_month:revision.closingDate.slice(0,7),statement_file:String((revision.rawPayload as {file?:string}).file??""),purchaseCents:p.principalMinor});
  }
  for(const charge of await accountingHistoricalChargesTx(tx))refs.set(charge.fingerprint,charge);
  const historical=latestHistoricalAssociation(await tx.historicalAssociations(f.revisionId));
  const charge=link?.action==="link"&&link.purchaseId?refs.get(link.purchaseId)??null:historical?.action==="link"?refs.get(HISTORICAL_CHARGE_PREFIX+historical.sourceLineId)??null:null;
  const occupied=new Set(allLinks.filter(d=>d.action==="link"&&d.receiptRevisionId!==f.revisionId&&!allLinks.some(child=>child.previousDecisionId===d.id)).map(d=>d.purchaseId));
  for(const association of currentHistoricalAssociations(await tx.historicalAssociations()).filter(row=>row.receiptRevisionId!==f.revisionId))occupied.add(HISTORICAL_CHARGE_PREFIX+association.sourceLineId);
  const candidates=[...refs.values()].filter(c=>!occupied.has(c.fingerprint)&&(historicalSourceLineId(c.fingerprint)?amountMatches(c.ars,c.installment_count,f.totalMinor!):c.purchaseCents===f.totalMinor)&&Math.abs(Date.parse(c.date!)-Date.parse(f.date!))<=3*86400000);
  return {id:f.receiptId,date:f.date!,totalCents:f.totalMinor!,charge,candidates:charge?[]:candidates,state:charge?"matched":candidates.length>1?"pending":"unmatched",method:charge?(historicalSourceLineId(charge.fingerprint)?historical?.method??"manual":"manual"):null,historicalAssociationId:historical?.id??null,historical:!!charge&&historicalSourceLineId(charge.fingerprint)!==null};
}
export async function accountingReceiptDetail(context:AccountingContext,id:number) {
  const data=await context.ledger.transaction(async tx=>{
    const facts=await receiptRevisionForId(tx,id);if(!facts)return null;
    const revision=await tx.sourceRevision(facts.revisionId),side=await accountingReceiptSideTx(tx,facts);
    const products=(await tx.reviewSubjects("product")) as ProductSubject[],matches=(await tx.reviewSubjects("match")) as MatchSubject[],accounts=await tx.catalogAccounts();
    const link=latestReceiptDecision(await tx.receiptLinkDecisions(facts.revisionId));
    const purchase=await tx.purchase(link?.action==="link"&&link.purchaseId?link.purchaseId:`receipt-purchase:${facts.receiptId}`);
    const reviews=await tx.reviewEvents(facts.revisionId);
    return {facts,revision:revision!,side,products,matches,accounts,purchase,link,reviews:reviews.filter(event=>event.state==="open"&&!reviews.some(child=>child.priorDecisionId===event.id))};
  });
  if(!data)return null;
  const f=data.facts,h=f.parsed.header,footer=f.parsed.footer,r=data.revision;
  const transcript=(await context.documents.read(f.correctedRowsObject??f.originalRowsObject)).toString("utf8"),originalTranscript=(await context.documents.read(f.originalRowsObject)).toString("utf8");
  return {...data,originalTranscript,detail:{
    receipt:{...receiptSummary(f),chain:f.chain,branch_code:h.branchCode,fiscal_number:h.fiscalNumber!,file_sha256:r.documentHash,file_path:r.objectPath,register:h.register,terminal:h.terminal,trx:h.trx,cae:h.cae,cae_due:h.caeDue,payment_method:h.paymentMethod,payment_ref:h.paymentRef,ocr_scale:f.scale,created_at:r.recordedAt},
    header:{cuit:h.cuit,paymentCents:h.paymentCents,savingsCents:footer.savingsCents,offers:footer.offers,notes:f.parsed.notes},report:f.report,transcript,
    items:f.parsed.items.map((item,i)=>{
      const id=sourceLineId(f.revisionId,i+1),match=data.matches.find(m=>m.id===id&&m.reviewed);
      const product=data.products.find(p=>p.id===match?.productId&&p.reviewed&&!p.redirectId);
      const unit=match?.unitCorrection?.from===item.unit&&product?.unit===match.unitCorrection.to?match.unitCorrection.to:item.unit;
      return {id,position:item.position,desc_printed:item.descPrinted,no_promo:item.noPromo?1:0,sku:item.sku,ean:item.ean,qty_milli:item.qtyMilli,unit,unit_price_cents:item.unitPriceCents,line_total_cents:item.lineTotalCents!,discounts:item.discounts.map((d,j)=>({id:`${sourceLineId(f.revisionId,i+1)}:${j}`,position:j+1,label:d.label,tag:d.tag,amount_cents:d.amountCents}))};}),
  }};
}
export async function accountingReconciliation(ledger:LedgerPort) {
  return ledger.transaction(async tx=>{
    const facts=await currentReceiptsTx(tx),receipts=await Promise.all(facts.map(f=>accountingReceiptSideTx(tx,f))),allIdentities=await tx.allPurchaseIdentities(),charges=new Map<string,ChargeRef & {receiptId:number|null;receiptDate:string|null}>();
    for(const identity of allIdentities){if(identity.currency!=="ARS")continue;const source=await tx.sourceLine(identity.sourceLineId);if(!source||!/COTO/i.test(String(source.payload.description??"")))continue;const p=await tx.purchase(identity.purchaseId),revision=await tx.sourceRevision(source.revisionId);if(!p||!revision?.closingDate)continue;const linked=receipts.find(r=>r.charge?.fingerprint===p.purchaseId);charges.set(p.purchaseId,{fingerprint:p.purchaseId,brand:p.cardId,date:p.effectiveDate,description:String(source.payload.description),merchant:"COTO",ars:identity.amountMinor/100,installment_number:identity.installment,installment_count:identity.installmentCount,cycle_month:revision.closingDate.slice(0,7),statement_file:String((revision.rawPayload as {file?:string}).file??""),purchaseCents:p.principalMinor,receiptId:linked?.id??null,receiptDate:linked?.date??null});}
    for(const charge of await accountingHistoricalChargesTx(tx)){const linked=receipts.find(receipt=>receipt.charge?.fingerprint===charge.fingerprint);charges.set(charge.fingerprint,{...charge,receiptId:linked?.id??null,receiptDate:linked?.date??null});}
    const historicalAssociations=await tx.historicalAssociations();
    const rows=[...charges.values()],matchedCents=rows.filter(c=>c.receiptId!==null).reduce((s,c)=>s+c.purchaseCents,0);
    const pendingSourceRows=(await tx.statementSourceLines(null)).filter(({line})=>line.payload.section==="purchases"&&/COTO/i.test(String(line.payload.description??""))&&!allIdentities.some(identity=>identity.sourceLineId===line.id)).map(({line,revision})=>({id:line.id,cardId:revision.cardId!,date:String(line.payload.date??""),description:String(line.payload.description??""),ars:typeof line.payload.ars==="number"?line.payload.ars:null,usd:typeof line.payload.usd==="number"?line.payload.usd:null,installment:line.payload.installment_number,installmentCount:line.payload.installment_count}));
    return {receipts,charges:rows,pendingSourceRows:pendingSourceRows.filter(row=>!charges.has(HISTORICAL_CHARGE_PREFIX+row.id)),historicalAssociations,summary:{chargedCents:rows.reduce((s,c)=>s+c.purchaseCents,0),analyzedCents:receipts.reduce((s,r)=>s+r.totalCents,0),matchedCents,unmatchedCharges:rows.filter(c=>c.receiptId===null).length,pendingReceipts:receipts.filter(r=>r.state==="pending").length}};
  });
}
export async function accountingProductReview(ledger:LedgerPort) {
  return ledger.transaction(async tx=>{
    const products=(await tx.reviewSubjects("product")) as ProductSubject[],matches=(await tx.reviewSubjects("match")) as MatchSubject[],codes=(await tx.reviewSubjects("code")) as CodeSubject[];
    const active=products.filter(p=>p.redirectId===null),queue=[];
    for(const p of [...active].sort((a,b)=>Number(a.reviewed)-Number(b.reviewed)||a.name.localeCompare(b.name))){
      const selected=matches.filter(m=>m.productId===p.id),lines=await Promise.all(selected.map(m=>tx.sourceLine(m.sourceLineId)));
      queue.push({id:Number(p.id),reviewed:p.reviewed,name:p.name,category:p.category,unit:p.unit,timesBought:selected.length,totalSpentCents:lines.reduce((s,l)=>s+Number(l?.payload.lineTotalCents??0)+(Array.isArray(l?.payload.discounts)?l.payload.discounts.reduce((n,d)=>n+Number(d.amountCents),0):0),0),descriptions:[...new Set(lines.map(l=>String(l?.payload.descPrinted??"")))],codes:codes.filter(c=>c.productId===p.id).map(c=>c.sku)});
    }
    return {queue,options:active.map(p=>({id:Number(p.id),name:p.name,category:p.category,unit:p.unit}))};
  });
}
