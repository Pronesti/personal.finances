import { randomUUID } from "node:crypto";
import { AccountingError, type OpeningObligation, type OpeningBillingInput, type PostResult } from "./model";
import type { LedgerPort, LedgerTx } from "./port";
import { exactMinor, qualifiedCommandKey, validDate } from "./journal";
import { splitMinor } from "./purchases";
import { appendValidatedJournal, commandTx, digest, replayAttributionsTx } from "./use-cases";

export async function registerOpeningObligationTx(tx:LedgerTx,o:OpeningObligation):Promise<void> {
 const existing=await tx.openingObligation(o.id);
 if(existing) {if(digest({...existing,recordedAt:""})!==digest({...o,recordedAt:""})) throw new AccountingError("opening_obligation_conflict");return;}
 if(!o.id.trim() || !validDate(o.purchaseDate) || new Set(o.evidenceIds).size!==o.evidenceIds.length || o.evidenceIds.some(id=>!id.trim())) throw new AccountingError("invalid_opening_obligation");
 const opening=await tx.journal(o.openingJournalId);
 if(!opening || opening.kind!=="opening" || opening.cardId!==o.cardId || opening.currency!==o.currency || o.purchaseDate>opening.effectiveDate || !o.evidenceIds.length) throw new AccountingError("invalid_opening_obligation");
 for(const n of [o.originalPrincipalMinor,o.remainingMinor]) if(!exactMinor(n)||n===0) throw new AccountingError("invalid_opening_obligation");
 exactMinor(o.alreadyBilledMinor);
 if((o.alreadyBilledMinor===0)!==(o.lastBilledInstallment===0)||o.originalPrincipalMinor!==o.alreadyBilledMinor+o.remainingMinor || !Number.isSafeInteger(o.lastBilledInstallment)||o.lastBilledInstallment<0||!Number.isSafeInteger(o.installmentCount)||o.installmentCount<=o.lastBilledInstallment) throw new AccountingError("invalid_opening_obligation");
 if(!o.allocations.length || o.allocations.some(a=>!exactMinor(a.minor)) || o.allocations.reduce((n,a)=>exactMinor(n+a.minor),0)!==o.remainingMinor) throw new AccountingError("invalid_opening_obligation_allocation");
 const capacity=opening.lines.filter(l=>l.accountId===`${o.cardId}:${o.currency}:unbilled`).reduce((n,l)=>n+l.creditMinor-l.debitMinor,0);
 const registered=(await tx.openingObligations(o.cardId,o.currency)).filter(v=>v.openingJournalId===o.openingJournalId).reduce((n,v)=>exactMinor(n+v.remainingMinor),0);
 if(registered+o.remainingMinor>capacity) throw new AccountingError("opening_obligation_exceeds_balance");
 await tx.appendOpeningObligation(o);
}
export async function registerOpeningObligation(port:LedgerPort,o:OpeningObligation):Promise<void> {return port.transaction(tx=>registerOpeningObligationTx(tx,o));}
export async function billOpeningInstallment(port:LedgerPort,input:OpeningBillingInput):Promise<PostResult> {return port.transaction(tx=>billOpeningInstallmentTx(tx,input));}
export async function billOpeningInstallmentTx(tx:LedgerTx,input:OpeningBillingInput):Promise<PostResult> {
 if(!Number.isSafeInteger(input.installment)||input.installment<1||!exactMinor(input.amountMinor)||input.amountMinor===0||!input.evidenceIds.length) throw new AccountingError("invalid_billing");
 return commandTx(tx,qualifiedCommandKey(input.cardId,input.key),digest(input),async tx=>{
  const review=(reviewCode:string):PostResult=>({status:"review",journalIds:[],reviewCode});
  const o=await tx.openingObligation(input.openingObligationId);
  if(!o||o.cardId!==input.cardId||o.currency!==input.currency) return review("missing_supported_opening_obligation");
  const opening=await tx.journal(o.openingJournalId);
  if(!opening||input.effectiveDate<=opening.effectiveDate||input.installment<=o.lastBilledInstallment||input.installment>o.installmentCount) return review("unsupported_opening_installment");
  const bills=await tx.openingBillings(o.id),prior=bills.find(b=>b.installment===input.installment);
  if(prior) return prior.amountMinor===input.amountMinor&&prior.effectiveDate===input.effectiveDate?{status:"duplicate",journalIds:[prior.journalId],reviewCode:null}:review("conflicting_installment");
  if(bills.reduce((n,b)=>exactMinor(n+b.amountMinor),0)+input.amountMinor>o.remainingMinor) return review("billing_exceeds_opening_remaining");
  const id=randomUUID();
  await appendValidatedJournal(tx,{id,commandKey:qualifiedCommandKey(input.cardId,input.key),cardId:input.cardId,currency:input.currency,effectiveDate:input.effectiveDate,recordedAt:input.recordedAt,kind:"billing",reversesId:null,evidenceIds:input.evidenceIds,lines:[{accountId:`${input.cardId}:${input.currency}:unbilled`,debitMinor:input.amountMinor,creditMinor:0,purchaseId:null,purposeId:null},{accountId:`${input.cardId}:${input.currency}:billed`,debitMinor:0,creditMinor:input.amountMinor,purchaseId:null,purposeId:null}]});
  const amounts=splitMinor(input.amountMinor,o.allocations.map(a=>a.minor));
  await tx.appendBilling({origin:"opening_installment",id,journalId:id,openingObligationId:o.id,purchaseId:null,cardId:o.cardId,currency:o.currency,installment:input.installment,amountMinor:input.amountMinor,effectiveDate:input.effectiveDate,purchaseDate:o.purchaseDate,components:o.allocations.map((a,i)=>({id:`${id}:${i}`,purposeId:a.purposeId,minor:amounts[i]})).filter(c=>c.minor>0)});
  await replayAttributionsTx(tx,o.cardId,o.currency);
  return {status:"posted",journalIds:[id],reviewCode:null};
 });
}
