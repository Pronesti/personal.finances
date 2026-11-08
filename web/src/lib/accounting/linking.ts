import { createHash, randomUUID } from "node:crypto";
import { amountMatches, MATCH_WINDOW_DAYS } from "@/lib/receipts/charges";
import { verify } from "@/lib/receipts/verify";
import { AccountingError, type Currency, type PurchaseInput } from "./model";
import { exactMinor } from "./journal";
import { sourceLineId, sourceAmountMinor } from "./evidence";
import type { EvidenceLedgerPort, EvidenceLedgerTx, ImportResult, ReceiptFacts, ReceiptLinkDecision } from "./evidence-port";
import { registerMerchantPurchaseTx } from "./review";
import { recordPurchaseTx, correctPurchaseTx, billInstallmentTx } from "./use-cases";
import { currentHistoricalAssociations } from "./historical-links";
export type ReceiptReconcileInput = {
  key: string; receiptRevisionId: string; cardId: string | null; paymentVerified: boolean; purchaseId: string | null;
  allocation: {accountId:string;purposeId:string;minor:number}[] | null;
  itemAllocations?: {sourceLineId:string;accountId:string;purposeId:string;minor:number}[];
  recordedAt: string;
};
const digest=(value:unknown):string=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function latestReceiptDecision(decisions:ReceiptLinkDecision[]):ReceiptLinkDecision|null {
  return decisions.find(d=>!decisions.some(child=>child.previousDecisionId===d.id))??null;
}
/** Association changes do not undo the last explicit financial allocation. */
export function retainedReceiptItemAllocations(decisions:ReceiptLinkDecision[],purchaseId:string|null):ReceiptLinkDecision['itemAllocations'] {
  let current=latestReceiptDecision(decisions);const seen=new Set<string>();
  while(current && purchaseId!==null && current.purchaseId===purchaseId && !seen.has(current.id)) {
    seen.add(current.id);
    if(!Array.isArray(current.itemAllocations)) throw new AccountingError('invalid_receipt_allocation');
    if(current.allocation!==null || current.itemAllocations.length>0) return current.itemAllocations;
    current=decisions.find(row=>row.id===current!.previousDecisionId)??null;
  }
  return [];
}
function currentLinks(decisions:ReceiptLinkDecision[]):ReceiptLinkDecision[] {
  return [...new Set(decisions.map(d=>d.receiptRevisionId))].map(id=>latestReceiptDecision(decisions.filter(d=>d.receiptRevisionId===id))).filter((d):d is ReceiptLinkDecision=>d!==null&&d.action==="link");
}
const daysApart=(a:string,b:string):number=>Math.abs(Date.parse(`${a}T00:00:00Z`)-Date.parse(`${b}T00:00:00Z`))/86400000;
const isRetailer=(description:unknown,chain:string):boolean=>chain==="coto"&&typeof description==="string"&&/(?:^|[^A-Z])COTO(?:[^A-Z]|$)/i.test(description);
async function statementCandidates(tx:EvidenceLedgerTx,receipt:ReceiptFacts,cardId:string|null) {
  const identities=await tx.allPurchaseIdentities(),found=new Map<string,Awaited<ReturnType<EvidenceLedgerTx["purchase"]>>>();
  for(const identity of identities) {
    if(cardId!==null && identity.cardId!==cardId || identity.currency!=="ARS" || !receipt.date || daysApart(identity.purchaseDate,receipt.date)>MATCH_WINDOW_DAYS) continue;
    let revisionId:string;
    try {revisionId=(JSON.parse(identity.sourceLineId) as [string,number])[0];}catch{continue;}
    const revision=await tx.sourceRevision(revisionId);
    if(revision?.kind!=="statement" || revision.admission!=="accepted") continue;
    const line=(await tx.sourceLines(revisionId)).find(l=>l.id===identity.sourceLineId);
    if(!isRetailer(line?.payload.description,receipt.chain)) continue;
    const purchase=await tx.purchase(identity.purchaseId);
    if(purchase) found.set(purchase.purchaseId,purchase);
  }
  return [...found.values()].filter((p):p is NonNullable<typeof p>=>p!==null);
}
async function unpostedStatementEvidence(tx:EvidenceLedgerTx,receipt:ReceiptFacts,cardId:string|null) {
  const identities=await tx.allPurchaseIdentities();
  const rows=(await tx.statementSourceLines(cardId)).filter(({line})=>{
    const p=line.payload;
    if(identities.some(i=>i.sourceLineId===line.id) || p.section!=="purchases" || typeof p.date!=="string" || !receipt.date || daysApart(p.date,receipt.date)>MATCH_WINDOW_DAYS || !isRetailer(p.description,receipt.chain) || typeof p.ars!=="number" || p.ars<=0 || p.usd!==null && p.usd!==undefined && p.usd!==0) return false;
    return amountMatches(p.ars,typeof p.installment_count==="number"?p.installment_count:null,receipt.totalMinor!);
  });
  const ambiguous=rows.length>1 && (new Set(rows.map(r=>r.revision.cardId)).size!==1 || new Set(rows.map(r=>r.line.revisionId)).size!==rows.length || rows.some(r=>typeof r.line.payload.voucher!=="string" || !r.line.payload.voucher.trim()) || new Set(rows.map(r=>JSON.stringify([r.line.payload.voucher,r.line.payload.date,r.line.payload.installment_count]))).size!==1 || new Set(rows.map(r=>r.line.payload.installment_number)).size!==rows.length);
  return {rows,ambiguous};
}
async function allocations(tx:EvidenceLedgerTx,receipt:ReceiptFacts,input:ReceiptReconcileInput) {
  const total=exactMinor(receipt.totalMinor!);
  const approved=async(id:string)=>{
    const events=(await tx.reviewEvents(id)).filter(e=>e.code==="receipt_item_identity_reviewed");
    const latest=events.find(e=>!events.some(child=>child.priorDecisionId===e.id));
    return latest?.state==="reviewed";
  };
  const aggregate=(rows:{accountId:string;purposeId:string;minor:number}[])=>{
    const result=new Map<string,{accountId:string;purposeId:string;minor:number}>();
    for(const row of rows) {const key=JSON.stringify([row.accountId,row.purposeId]),old=result.get(key);result.set(key,{accountId:row.accountId,purposeId:row.purposeId,minor:exactMinor((old?.minor??0)+exactMinor(row.minor))});}
    return [...result.values()].filter(a=>a.minor>0);
  };
  if(input.itemAllocations?.length) {
    if(input.allocation!==null) throw new AccountingError("conflicting_receipt_allocations");
    const seen=new Set<string>();let covered=0;
    for(const a of input.itemAllocations) {
      const index=receipt.parsed.items.findIndex((_,i)=>sourceLineId(receipt.revisionId,i+1)===a.sourceLineId);
      if(index<0 || seen.has(a.sourceLineId)) throw new AccountingError("invalid_receipt_item_allocation");
      if(!await approved(a.sourceLineId)) throw new AccountingError("product_identity_unreviewed");
      const item=receipt.parsed.items[index],net=(item.lineTotalCents??0)+item.discounts.reduce((s,d)=>s+d.amountCents,0);
      if(!exactMinor(a.minor) || a.minor!==net) throw new AccountingError("receipt_item_allocation_mismatch");
      seen.add(a.sourceLineId);covered=exactMinor(covered+a.minor);
    }
    if(covered>total) throw new AccountingError("allocation_mismatch");
    return aggregate([...input.itemAllocations,...(covered<total?[{accountId:"expense:unallocated",purposeId:"unallocated",minor:total-covered}]:[])]);
  }
  if(input.allocation!==null) {
    for(let i=0;i<receipt.parsed.items.length;i++) if(!await approved(sourceLineId(receipt.revisionId,i+1))) throw new AccountingError("product_identity_unreviewed");
    const sum=input.allocation.reduce((s,a)=>exactMinor(s+exactMinor(a.minor)),0);
    if(sum!==total || !input.allocation.length || input.allocation.some(a=>a.minor===0)) throw new AccountingError("allocation_mismatch");
    return aggregate(input.allocation);
  }
  return null;
}

export async function reconcileReceipt(port:EvidenceLedgerPort,input:ReceiptReconcileInput):Promise<ImportResult> {
  return port.transaction(tx=>reconcileReceiptTx(tx,input));
}
export async function reconcileReceiptTx(tx:EvidenceLedgerTx,input:ReceiptReconcileInput):Promise<ImportResult> {
  if(!input.key.trim()) throw new AccountingError("invalid_identity");
  const commandKey=`source:${input.receiptRevisionId}:reconcile:${encodeURIComponent(input.key)}`;
  const commandDigest=digest({...input,recordedAt:null}),old=await tx.sourceImportCommand(commandKey);
  if(old) {if(old.digest!==commandDigest) throw new AccountingError("command_conflict");return {...old.result,postedJournalIds:[],duplicate:true};}
  const receipt=await tx.receiptFacts(input.receiptRevisionId),revision=await tx.sourceRevision(input.receiptRevisionId);
  if(!receipt || revision?.kind!=="receipt" || revision.admission!=="accepted" || !verify(receipt.parsed).ok || !receipt.date || receipt.totalMinor===null) throw new AccountingError("receipt_not_accepted");
  const result:ImportResult={sourceRevisionId:input.receiptRevisionId,purchaseIds:[],postedJournalIds:[],reviews:[],duplicate:false};
  const review=async(code:string,params:Record<string,string|number>={})=>{
    const row={code,params,sourceLineIds:[]};result.reviews.push(row);
    await tx.appendReviewEvent({...row,id:randomUUID(),subjectId:input.receiptRevisionId,priorDecisionId:null,state:"open",recordedAt:input.recordedAt});
  };
  const decisionHistory=await tx.receiptLinkDecisions(input.receiptRevisionId);
  const previous=latestReceiptDecision(decisionHistory);
  const historicalLinks = currentHistoricalAssociations(await tx.historicalAssociations());
  const historicalReceiptLink = historicalLinks.find(link => link.receiptRevisionId === input.receiptRevisionId);
  let target=input.purchaseId?await tx.purchase(input.purchaseId):previous?.action==="link"&&previous.purchaseId?await tx.purchase(previous.purchaseId):await tx.purchase(`receipt-purchase:${receipt.receiptId}`);
  if(input.purchaseId && !target) throw new AccountingError("missing_supported_purchase");
  if(!target) {
    const nearby=await statementCandidates(tx,receipt,input.cardId),candidates=nearby.filter(p=>p.principalMinor===receipt.totalMinor);
    if(candidates.length===0 && nearby.length>0) await review("receipt_amount_mismatch",{receiptMinor:receipt.totalMinor,candidateMinor:nearby[0].principalMinor});
    if(candidates.length>1) await review("multiple_receipt_candidates",{count:candidates.length});
    else if(candidates.length===1) target=candidates[0];
  }
  const unposted=!target && result.reviews.length===0?await unpostedStatementEvidence(tx,receipt,input.cardId):{rows:[],ambiguous:false};
  if(unposted.ambiguous) await review("multiple_statement_candidates",{count:unposted.rows.length});
  const requestedAllocation=await allocations(tx,receipt,input);
  const occupied=currentLinks(await tx.allReceiptLinkDecisions());
  if (target) {
    const identities = await tx.allPurchaseIdentities();
    const samePurchaseSource = (sourceId: string) => identities.some(identity => identity.purchaseId === target!.purchaseId && identity.sourceLineId === sourceId);
    if (historicalReceiptLink && !samePurchaseSource(historicalReceiptLink.sourceLineId)) { await review("receipt_has_historical_association"); target = null; }
    else if (historicalLinks.some(link => link.receiptRevisionId !== input.receiptRevisionId && samePurchaseSource(link.sourceLineId))) { await review("purchase_already_linked"); target = null; }
  }
  if(target && occupied.some(l=>l.purchaseId===target!.purchaseId && l.receiptRevisionId!==input.receiptRevisionId)) {
    await review("purchase_already_linked");target=null;
  }
  if(target && (target.currency!=="ARS" || target.principalMinor!==receipt.totalMinor || input.cardId!==null && target.cardId!==input.cardId)) {
    await review("receipt_amount_or_card_mismatch",{receiptMinor:receipt.totalMinor,purchaseMinor:target.principalMinor});target=null;
  }
  if(!target && result.reviews.length===0) {
    const h=receipt.parsed.header;
    const openingDate = input.cardId ? await tx.openingDate(input.cardId, "ARS") : null;
    if (openingDate && receipt.date <= openingDate) await review("historical_receipt_requires_opening_reconciliation", { openingDate });
    else if (historicalReceiptLink && !unposted.rows.some(row => row.line.id === historicalReceiptLink.sourceLineId && row.revision.cardId === input.cardId)) await review("receipt_has_historical_association");
    else if(!input.paymentVerified || !input.cardId || !h.paymentMethod || h.paymentCents!==receipt.totalMinor) await review("receipt_payment_unresolved");
    else if(!await tx.account(`${input.cardId}:ARS:unbilled`)) await review("unknown_card");
    else {
      const purchaseId=`receipt-purchase:${receipt.receiptId}`,allocation=requestedAllocation??[{accountId:"expense:unallocated",purposeId:"unallocated",minor:receipt.totalMinor}];
      const posted=await recordPurchaseTx(tx,{key:`receipt-entity:${receipt.receiptId}:purchase`,purchaseId,cardId:input.cardId,currency:"ARS",effectiveDate:receipt.date,recordedAt:input.recordedAt,evidenceIds:[input.receiptRevisionId],principalMinor:receipt.totalMinor,allocations:allocation});
      if(posted.status==="review") await review(posted.reviewCode??"receipt_financial_review");
      else {
        if(posted.status==="posted") result.postedJournalIds.push(...posted.journalIds);target=await tx.purchase(purchaseId);result.purchaseIds.push(purchaseId);
        await registerMerchantPurchaseTx(tx,{purchaseId,cardId:input.cardId,normalizedName:receipt.chain.toUpperCase(),sourceLineId:sourceLineId(receipt.revisionId,1)});
        for(const {line,revision:statement} of unposted.rows) {
          const p=line.payload,amountMinor=sourceAmountMinor(p.ars as number);
          const billing=await billInstallmentTx(tx,{key:`receipt:${receipt.revisionId}:adopt:${line.id}`,purchaseId,cardId:input.cardId,currency:"ARS",installment:typeof p.installment_number==="number"?p.installment_number:1,amountMinor,effectiveDate:statement.closingDate!,recordedAt:input.recordedAt,evidenceIds:[line.id,receipt.revisionId]});
          if(billing.status==="review") await review(billing.reviewCode??"receipt_billing_review");
          else {
            if(billing.status==="posted") result.postedJournalIds.push(...billing.journalIds);
            await tx.appendPurchaseIdentity({purchaseId,cardId:input.cardId,currency:"ARS",purchaseDate:p.date as string,voucher:typeof p.voucher==="string"?p.voucher:null,installment:typeof p.installment_number==="number"?p.installment_number:null,installmentCount:typeof p.installment_count==="number"?p.installment_count:null,amountMinor,sourceLineId:line.id});
          }
        }
      }
    }
  }
  if(target && result.reviews.length===0) {
    if(requestedAllocation && JSON.stringify(requestedAllocation)!==JSON.stringify(target.allocations)) {
      const replacement:PurchaseInput={key:`receipt:${input.receiptRevisionId}:allocation`,purchaseId:target.purchaseId,cardId:target.cardId,currency:target.currency,effectiveDate:target.effectiveDate,recordedAt:input.recordedAt,evidenceIds:[...new Set([...target.evidenceIds,input.receiptRevisionId])],principalMinor:target.principalMinor,allocations:requestedAllocation};
      const corrected=await correctPurchaseTx(tx,{key:`receipt:${input.receiptRevisionId}:allocation:${input.key}`,cardId:target.cardId,purchaseId:target.purchaseId,expectedVersion:target.version,replacement,recordedAt:input.recordedAt,reason:"reviewed receipt item allocation"});
      if(corrected.status==="review") await review(corrected.reviewCode??"receipt_allocation_review");
      else if(corrected.status==="posted") result.postedJournalIds.push(...corrected.journalIds);
    }
    if(result.reviews.length===0) {
      await tx.appendReceiptLinkDecision({id:randomUUID(),key:commandKey,receiptRevisionId:input.receiptRevisionId,purchaseId:target.purchaseId,cardId:target.cardId,paymentVerified:input.paymentVerified || previous?.purchaseId===target.purchaseId && previous.paymentVerified,action:"link",recordedAt:input.recordedAt,previousDecisionId:previous?.id??null,allocation:requestedAllocation,itemAllocations:input.itemAllocations??(input.allocation===null?retainedReceiptItemAllocations(decisionHistory,target.purchaseId):[])});
      if(!result.purchaseIds.includes(target.purchaseId)) result.purchaseIds.push(target.purchaseId);
      const reviewHistory=await tx.reviewEvents(input.receiptRevisionId),resolvedCodes=new Set(["receipt_payment_unresolved","multiple_receipt_candidates","receipt_amount_mismatch","purchase_already_linked","unknown_card","receipt_amount_or_card_mismatch","multiple_statement_candidates"]);
      for(const event of reviewHistory.filter(event=>event.state==="open"&&resolvedCodes.has(event.code)&&!reviewHistory.some(child=>child.priorDecisionId===event.id))) await tx.appendReviewEvent({...event,id:randomUUID(),priorDecisionId:event.id,state:"reviewed",recordedAt:input.recordedAt});
    }
  }
  await tx.appendSourceImportCommand({key:commandKey,digest:commandDigest,result});return result;
}
export async function unlinkReceipt(port:EvidenceLedgerPort,input:{key:string;receiptRevisionId:string;recordedAt:string}):Promise<void> {
  await port.transaction(async tx=>{
    const receipt=await tx.receiptFacts(input.receiptRevisionId);if(!receipt) throw new AccountingError("missing_receipt_facts");
    const key=`source:${input.receiptRevisionId}:unlink:${encodeURIComponent(input.key)}`,history=await tx.receiptLinkDecisions(input.receiptRevisionId);
    if(history.some(d=>d.key===key)) return;
    const previous=latestReceiptDecision(history);
    await tx.appendReceiptLinkDecision({id:randomUUID(),key,receiptRevisionId:input.receiptRevisionId,purchaseId:previous?.purchaseId??null,cardId:previous?.cardId??null,paymentVerified:false,action:"unlink",recordedAt:input.recordedAt,previousDecisionId:previous?.id??null,allocation:null,itemAllocations:[]});
  });
}

/** Reuse a supported receipt-origin acquisition when its statement billing arrives later. */
export async function receiptPurchaseForStatement(tx:EvidenceLedgerTx,input:{cardId:string;currency:Currency;date:string;amountMinor:number;description:string;installmentCount:number|null;sourceLineId:string}):Promise<{purchaseId:string|null;reviewCode:string|null}> {
  if(input.currency!=="ARS") return {purchaseId:null,reviewCode:null};
  const receipts=await tx.acceptedReceipts(),links=await tx.allReceiptLinkDecisions(),candidates=new Set<string>();
  for(const receipt of receipts) {
    if(!receipt.date || receipt.totalMinor===null || !isRetailer(input.description,receipt.chain) || daysApart(receipt.date,input.date)>MATCH_WINDOW_DAYS) continue;
    const link=links.find(l=>l.receiptRevisionId===receipt.revisionId && l.cardId===input.cardId && l.paymentVerified && l.action==="link");
    if(!link?.purchaseId || !amountMatches(input.amountMinor/100,input.installmentCount,receipt.totalMinor)) continue;
    const purchase=await tx.purchase(link.purchaseId);
    const existing=await tx.allPurchaseIdentities();
    const sameDocumentOtherOccurrence=existing.some(identity=>{
      if(identity.purchaseId!==link.purchaseId || identity.sourceLineId===input.sourceLineId) return false;
      try {return (JSON.parse(identity.sourceLineId) as [string,number])[0]===(JSON.parse(input.sourceLineId) as [string,number])[0];} catch{return false;}
    });
    if(!sameDocumentOtherOccurrence && purchase?.principalMinor===receipt.totalMinor && purchase.evidenceIds.includes(receipt.revisionId)) candidates.add(link.purchaseId);
  }
  if(candidates.size>1) return {purchaseId:null,reviewCode:"multiple_receipt_candidates"};
  return {purchaseId:[...candidates][0]??null,reviewCode:null};
}
