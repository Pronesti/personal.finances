import { createHash, randomUUID } from "node:crypto";
import { AccountingError, type Journal, type PostResult, type PurchaseInput, type BillingInput, type PaymentInput, type LinkedCreditInput, type Line } from "./model";
import { exactMinor, qualifiedCommandKey, validateJournal } from "./journal";
import { correctionJournals } from "./corrections";
import { allocateOldestBilled, outstandingComponents, replayAttributions } from "./attribution";
import { purchaseLines, splitMinor } from "./purchases";
import type { LedgerPort, LedgerTx } from "./port";
export async function appendValidatedJournal(tx: LedgerTx, journal: Journal): Promise<void> {
  validateJournal(journal);
  for (const line of journal.lines) {
    const account=await tx.account(line.accountId);
    if(!account || !account.enabled || !account.posting || await tx.hasChildAccounts(account.id)) throw new AccountingError("invalid_posting_account",{accountId:line.accountId});
    if(account.currency!==null && account.currency!==journal.currency) throw new AccountingError("account_currency_mismatch",{accountId:account.id});
  }
  await tx.appendJournal(journal);
}
export async function postJournal(port: LedgerPort, journal: Journal, digest: string): Promise<PostResult> {
 return port.transaction(tx=>postJournalTx(tx,journal,digest));
}
export async function postJournalTx(tx: LedgerTx, journal: Journal, digest: string): Promise<PostResult> {
  validateJournal(journal);if(!digest.trim()) throw new AccountingError("invalid_digest");
  const key=qualifiedCommandKey(journal.cardId,journal.commandKey);
  return commandTx(tx,key,digest,async tx=>{await appendValidatedJournal(tx,{...journal,commandKey:key});return posted(journal.id);});
}
function posted(...journalIds: string[]): PostResult {return {status:"posted",journalIds,reviewCode:null};}
function review(code: string): PostResult {return {status:"review",journalIds:[],reviewCode:code};}
export async function commandTx(tx: LedgerTx,key: string,digest: string,work:(tx: LedgerTx)=>Promise<PostResult>): Promise<PostResult> {
 {
   const saved=await tx.command(key);
   if(saved) {if(saved.digest!==digest) throw new AccountingError("command_conflict",{key});return {...saved.result,status:saved.result.status==="review"?"review":"duplicate"};}
   const result=await work(tx);await tx.appendCommand({key,digest,result});return result;
 }
}
export function digest(input: {recordedAt: string}): string {
 const canonical=(value: unknown): unknown=>Array.isArray(value)?value.map(canonical):value!==null && typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>key!=="recordedAt").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
 return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}
function header(input: {key:string;cardId:string;currency:Journal["currency"];effectiveDate:string;recordedAt:string;evidenceIds:string[]},kind: Journal["kind"],lines:Line[]):Journal {
 return {id:randomUUID(),commandKey:qualifiedCommandKey(input.cardId,input.key),cardId:input.cardId,currency:input.currency,effectiveDate:input.effectiveDate,recordedAt:input.recordedAt,evidenceIds:input.evidenceIds,kind,reversesId:null,lines};
}
export async function recordPurchase(port: LedgerPort,input: PurchaseInput):Promise<PostResult> {
 return port.transaction(tx=>recordPurchaseTx(tx,input));
}
export async function recordPurchaseTx(tx: LedgerTx,input: PurchaseInput):Promise<PostResult> {
 const j=header(input,"purchase",purchaseLines(input));validateJournal(j);
 return commandTx(tx,j.commandKey,digest(input),async tx=>{
   const current=await tx.purchase(input.purchaseId);if(current) return review("purchase_already_recorded");
   for(const allocation of input.allocations) {const account=await tx.account(allocation.accountId);if(account && !["expense","asset"].includes(account.type)) return review("unsupported_financial_nature");}
   await appendValidatedJournal(tx,j);await tx.appendPurchase({...input,version:1,journalId:j.id});return posted(j.id);
 });
}
export async function billInstallment(port: LedgerPort,input: BillingInput):Promise<PostResult> {
 return port.transaction(tx=>billInstallmentTx(tx,input));
}
export async function billInstallmentTx(tx: LedgerTx,input: BillingInput):Promise<PostResult> {
 if(!Number.isSafeInteger(input.installment)||input.installment<1||!exactMinor(input.amountMinor)) throw new AccountingError("invalid_billing");
 const j=header(input,"billing",[{accountId:`${input.cardId}:${input.currency}:unbilled`,debitMinor:input.amountMinor,creditMinor:0,purchaseId:input.purchaseId,purposeId:null},{accountId:`${input.cardId}:${input.currency}:billed`,debitMinor:0,creditMinor:input.amountMinor,purchaseId:input.purchaseId,purposeId:null}]);validateJournal(j);
 return commandTx(tx,j.commandKey,digest(input),async tx=>{
   const purchase=await tx.purchase(input.purchaseId);if(!purchase || purchase.cardId!==input.cardId || purchase.currency!==input.currency) return review("missing_supported_purchase");
   if(input.effectiveDate<purchase.effectiveDate) return review("billing_before_purchase");
   const bills=await tx.billings(input.purchaseId), prior=bills.find(b=>b.installment===input.installment);
   if(prior) return prior.amountMinor===input.amountMinor && prior.effectiveDate===input.effectiveDate?{...posted(prior.journalId),status:"duplicate"}:review("conflicting_installment");
   const credits=await tx.linkedCredits(input.purchaseId);
   const billed=bills.reduce((sum,b)=>exactMinor(sum+b.amountMinor),0), unbilledCredits=credits.reduce((sum,c)=>exactMinor(sum+c.unbilledReductionMinor),0);
   if(exactMinor(billed+input.amountMinor+unbilledCredits)>purchase.principalMinor) return review("billing_exceeds_principal");
   const amounts=splitMinor(input.amountMinor,purchase.allocations.map(a=>a.minor));
   await appendValidatedJournal(tx,j);
   await tx.appendBilling({id:j.id,purchaseId:input.purchaseId,cardId:input.cardId,currency:input.currency,installment:input.installment,amountMinor:input.amountMinor,effectiveDate:input.effectiveDate,purchaseDate:purchase.effectiveDate,journalId:j.id,components:purchase.allocations.map((a,i)=>({id:`${j.id}:${i}`,purposeId:a.purposeId,minor:amounts[i]})).filter(c=>c.minor>0)});
   await replayAttributionsTx(tx,input.cardId,input.currency);
   return posted(j.id);
 });
}
export async function recordRepayment(port: LedgerPort,input: PaymentInput):Promise<PostResult> {
 return port.transaction(tx=>recordRepaymentTx(tx,input));
}
export async function recordRepaymentTx(tx: LedgerTx,input: PaymentInput):Promise<PostResult> {
 if(!exactMinor(input.amountMinor)) throw new AccountingError("invalid_payment");
 const j=header(input,"repayment",[{accountId:`${input.cardId}:${input.currency}:billed`,debitMinor:input.amountMinor,creditMinor:0,purchaseId:null,purposeId:null},{accountId:`clearing:${input.currency}:unresolved-source`,debitMinor:0,creditMinor:input.amountMinor,purchaseId:null,purposeId:null}]);validateJournal(j);
 return commandTx(tx,j.commandKey,digest(input),async tx=>{
   const state=await tx.attributionState(input.cardId,input.currency);
   const payment={...input,id:j.id,journalId:j.id,unappliedMinor:input.amountMinor};
   const decision=replayAttributions({...state,payments:[...state.payments,payment]}).find(p=>p.paymentId===payment.id)!;
   await appendValidatedJournal(tx,j);await tx.appendPayment({...payment,unappliedMinor:decision.unappliedMinor});
   await replayAttributionsTx(tx,input.cardId,input.currency);
   return posted(j.id);
 });
}
export async function recordLinkedCredit(port: LedgerPort,input: LinkedCreditInput):Promise<PostResult> {
 return port.transaction(tx=>recordLinkedCreditTx(tx,input));
}
export async function recordLinkedCreditTx(tx: LedgerTx,input: LinkedCreditInput):Promise<PostResult> {
 if(!exactMinor(input.amountMinor)||exactMinor(exactMinor(input.billedReductionMinor)+exactMinor(input.unbilledReductionMinor))!==input.amountMinor) throw new AccountingError("invalid_credit_split");
 return commandTx(tx,qualifiedCommandKey(input.cardId,input.key),digest(input),async tx=>{
   const purchase=await tx.purchase(input.purchaseId);if(!purchase || purchase.cardId!==input.cardId || purchase.currency!==input.currency) return review("missing_supported_purchase");
   const credits=await tx.linkedCredits(input.purchaseId), bills=await tx.billings(input.purchaseId);
   const previous=credits.reduce((sum,c)=>exactMinor(sum+c.amountMinor),0), billed=bills.reduce((sum,b)=>exactMinor(sum+b.amountMinor),0);
   const billedCredits=credits.reduce((sum,c)=>exactMinor(sum+c.billedReductionMinor),0),unbilledCredits=credits.reduce((sum,c)=>exactMinor(sum+c.unbilledReductionMinor),0);
   if(exactMinor(previous+input.amountMinor)>purchase.principalMinor || input.billedReductionMinor>billed-billedCredits || input.unbilledReductionMinor>purchase.principalMinor-billed-unbilledCredits) return review("unsupported_credit_schedule");
   const remainingWeights=purchase.allocations.map((a,i)=>a.minor-credits.flatMap(c=>c.allocationReductions).filter(r=>r.allocationIndex===i).reduce((sum,r)=>sum+r.minor,0));
   const shares=splitMinor(input.amountMinor,remainingWeights);
   const lines:Line[]=purchase.allocations.map((a,i)=>({accountId:a.accountId,debitMinor:0,creditMinor:shares[i],purchaseId:input.purchaseId,purposeId:a.purposeId})).filter(l=>l.creditMinor>0);
   if(input.billedReductionMinor) lines.push({accountId:`${input.cardId}:${input.currency}:billed`,debitMinor:input.billedReductionMinor,creditMinor:0,purchaseId:input.purchaseId,purposeId:null});
   if(input.unbilledReductionMinor) lines.push({accountId:`${input.cardId}:${input.currency}:unbilled`,debitMinor:input.unbilledReductionMinor,creditMinor:0,purchaseId:input.purchaseId,purposeId:null});
   const j=header(input,"credit",lines);
   const allocated=allocateOldestBilled(input.billedReductionMinor,(await tx.billedComponents(input.currency,input.cardId)).filter(c=>c.purchaseId===input.purchaseId));
   await appendValidatedJournal(tx,j);await tx.appendLinkedCredit({...input,id:j.id,journalId:j.id,allocationReductions:shares.map((minor,allocationIndex)=>({allocationIndex,minor})),componentReductions:allocated.assigned.map(a=>({componentId:a.componentId,minor:a.minor}))});await replayAttributionsTx(tx,input.cardId,input.currency);return posted(j.id);
 });
}

export async function correctPurchase(port:LedgerPort,input:import("./model").CorrectionInput):Promise<PostResult> {
 return port.transaction(tx=>correctPurchaseTx(tx,input));
}
export async function correctPurchaseTx(tx:LedgerTx,input:import("./model").CorrectionInput):Promise<PostResult> {
 if(!input.reason.trim() || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1) throw new AccountingError("invalid_correction");
 const key=qualifiedCommandKey(input.cardId,input.key);
 return commandTx(tx,key,digest(input),async tx=>{
  const current=await tx.purchase(input.purchaseId);
  if(!current) return review("missing_supported_purchase");
  if(current.version!==input.expectedVersion) throw new AccountingError("stale_purchase_version");
  const replacement={...input.replacement,key:input.key,recordedAt:input.recordedAt};
  if(current.cardId!==input.cardId || replacement.cardId!==input.cardId || replacement.purchaseId!==input.purchaseId || replacement.currency!==current.currency) throw new AccountingError("correction_identity_mismatch");
  const original=await tx.journal(current.journalId);if(!original) throw new AccountingError("missing_original_journal");
  const state=await tx.attributionState(input.cardId,current.currency), bills=state.billings.filter(b=>b.purchaseId===input.purchaseId), credits=state.credits.filter(c=>c.purchaseId===input.purchaseId);
  if((bills.length||credits.length) && replacement.principalMinor!==current.principalMinor) return review("correction_requires_schedule_revalidation");
  if(bills.some(b=>b.effectiveDate<replacement.effectiveDate)) return review("billing_before_purchase");
  const pair=correctionJournals(original,replacement,{reversalId:randomUUID(),replacementId:randomUUID(),commandKey:key,recordedAt:input.recordedAt});
  validateJournal(pair.reversal);validateJournal(pair.replacement);
  for(const a of replacement.allocations) {const account=await tx.account(a.accountId);if(account&&!['expense','asset'].includes(account.type)) return review("unsupported_financial_nature");}
  const version=current.version+1,componentRevisions:import("./model").ComponentRevision[]=[];
  for(const b of bills) {
   const amounts=splitMinor(b.amountMinor,replacement.allocations.map(a=>a.minor));
   const known=new Set([...b.components.map(c=>c.id),...state.componentRevisions.filter(r=>r.billingId===b.id).map(r=>r.componentId)]);
   replacement.allocations.forEach((a,i)=>{const componentId=`${b.id}:${i}`;if(amounts[i]===0&&!known.has(componentId)) return;known.delete(componentId);componentRevisions.push({id:randomUUID(),componentId,billingId:b.id,revision:version,purposeId:a.purposeId,minor:amounts[i],purchaseDate:replacement.effectiveDate});});
   for(const componentId of known) componentRevisions.push({id:randomUUID(),componentId,billingId:b.id,revision:version,purposeId:null,minor:0,purchaseDate:replacement.effectiveDate});
  }
  const revisions=[...state.componentRevisions,...componentRevisions],newAttributions:import("./model").Attribution[]=[],attributionRevisions:import("./model").AttributionRevision[]=[];
  const revisedCredits:import("./model").LinkedCredit[]=[],creditRevisions:import("./model").CreditRevision[]=[],creditPairs:{reversal:Journal;replacement:Journal}[]=[];
  let replayed:ReturnType<typeof replayAttributions>;
  try {replayed=replayAttributions({...state,componentRevisions:revisions});} catch(error) {if(error instanceof AccountingError&&error.code==="invalid_issuer_allocation") return review("correction_conflicts_with_issuer_allocation");throw error;}
  for(const decision of replayed) {
   const payment=state.payments.find(p=>p.id===decision.paymentId)!;
   const revision=1+Math.max(0,...state.attributions.filter(a=>a.paymentId===payment.id).map(a=>a.revision),...state.attributionRevisions.filter(a=>a.paymentId===payment.id).map(a=>a.revision));
   attributionRevisions.push({paymentId:payment.id,revision,unappliedMinor:decision.unappliedMinor});
   newAttributions.push(...decision.assigned.map(a=>({...a,id:randomUUID(),paymentId:payment.id,method:payment.issuerAllocations===null?"oldest_billed_first" as const:"issuer" as const,revision})));
  }
  const remainingWeights=replacement.allocations.map(a=>a.minor);
  const events=[...state.payments.map(payment=>({type:"payment" as const,id:payment.id,effectiveDate:payment.effectiveDate,recordedAt:payment.recordedAt,payment})),...state.credits.map(credit=>({type:"credit" as const,id:credit.id,effectiveDate:credit.effectiveDate,recordedAt:credit.recordedAt,credit}))].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id));
  for(const event of events) {
   if(event.type==="payment") continue;
   const earlierIds=new Set(state.payments.filter(p=>p.effectiveDate<event.effectiveDate||(p.effectiveDate===event.effectiveDate&&(p.recordedAt<event.recordedAt||(p.recordedAt===event.recordedAt&&p.id<=event.id)))).map(p=>p.id));
   const earlierRows=newAttributions.filter(a=>earlierIds.has(a.paymentId));
   const components=outstandingComponents(state.billings,earlierRows,revisedCredits,revisions,attributionRevisions,state.payments).filter(c=>c.billedDate<=event.effectiveDate);
   if(event.type==="credit") {
    const credit=event.credit;
    if(credit.purchaseId!==input.purchaseId) {revisedCredits.push(credit);continue;}
    const oldJournal=await tx.journal(credit.journalId);if(!oldJournal) throw new AccountingError("missing_original_credit");
    const shares=splitMinor(credit.amountMinor,remainingWeights);shares.forEach((n,i)=>{remainingWeights[i]-=n;});
    const allocated=allocateOldestBilled(credit.billedReductionMinor,components.filter(c=>c.purchaseId===input.purchaseId));
    const reversal:Journal={...oldJournal,id:randomUUID(),commandKey:key,kind:"reversal",recordedAt:input.recordedAt,reversesId:oldJournal.id,lines:oldJournal.lines.map(l=>({...l,debitMinor:l.creditMinor,creditMinor:l.debitMinor}))};
    const replacementCredit:Journal={...oldJournal,id:randomUUID(),commandKey:key,kind:"replacement",recordedAt:input.recordedAt,reversesId:null,lines:[...replacement.allocations.map((a,i)=>({accountId:a.accountId,debitMinor:0,creditMinor:shares[i],purchaseId:input.purchaseId,purposeId:a.purposeId})).filter(l=>l.creditMinor>0),...oldJournal.lines.filter(l=>l.debitMinor>0).map(l=>({...l}))]};
    validateJournal(reversal);validateJournal(replacementCredit);creditPairs.push({reversal,replacement:replacementCredit});
    const updated={...credit,journalId:replacementCredit.id,allocationReductions:shares.map((minor,allocationIndex)=>({allocationIndex,minor})),componentReductions:allocated.assigned.map(a=>({componentId:a.componentId,minor:a.minor}))};
    revisedCredits.push(updated);creditRevisions.push({id:randomUUID(),creditId:credit.id,purchaseVersion:version,reversalJournalId:reversal.id,replacementJournalId:replacementCredit.id,recordedAt:input.recordedAt,credit:updated});continue;
   }

  }
  await appendValidatedJournal(tx,pair.reversal);await appendValidatedJournal(tx,pair.replacement);
  await tx.appendPurchase({...replacement,version,journalId:pair.replacement.id});
  await tx.appendCorrection({id:randomUUID(),purchaseId:input.purchaseId,fromVersion:current.version,toVersion:version,reversalJournalId:pair.reversal.id,replacementJournalId:pair.replacement.id,reason:input.reason,recordedAt:input.recordedAt});
  await tx.appendComponentRevisions(componentRevisions);await tx.appendAttributions(newAttributions);
  for(const r of attributionRevisions) await tx.appendAttributionRevision(r);
  for(const p of creditPairs) {await appendValidatedJournal(tx,p.reversal);await appendValidatedJournal(tx,p.replacement);}
  for(const r of creditRevisions) await tx.appendCreditRevision(r);
  return posted(pair.reversal.id,pair.replacement.id,...creditPairs.flatMap(p=>[p.reversal.id,p.replacement.id]));
 });
}

// Runs inside the caller's transaction; imports can retain evidence and refresh attribution atomically.
export async function replayAttributionsTx(tx:LedgerTx,cardId:string,currency:import("./model").Currency):Promise<void> {
 const state=await tx.attributionState(cardId,currency);
 for(const decision of replayAttributions(state)) {
  const payment=state.payments.find(p=>p.id===decision.paymentId)!;
  const revision=Math.max(0,...state.attributions.filter(a=>a.paymentId===payment.id).map(a=>a.revision),...state.attributionRevisions.filter(a=>a.paymentId===payment.id).map(a=>a.revision));
  const old=state.attributions.filter(a=>a.paymentId===payment.id&&a.revision===revision);
  const marker=state.attributionRevisions.find(a=>a.paymentId===payment.id&&a.revision===revision);
  const shape=(rows:{componentId:string;purposeId:string|null;minor:number}[])=>JSON.stringify(rows.map(a=>({componentId:a.componentId,purposeId:a.purposeId,minor:a.minor})).sort((a,b)=>a.componentId.localeCompare(b.componentId)));
  if(marker && marker.unappliedMinor===decision.unappliedMinor && shape(old)===shape(decision.assigned)) continue;
  await tx.appendAttributionRevision({paymentId:payment.id,revision:revision+1,unappliedMinor:decision.unappliedMinor});
  await tx.appendAttributions(decision.assigned.map(a=>({...a,id:randomUUID(),paymentId:payment.id,method:payment.issuerAllocations===null?"oldest_billed_first":"issuer",revision:revision+1})));
 }
}
