import {randomUUID} from 'node:crypto';
import {AccountingError,type Currency,type PostResult,type Journal} from './model';
import {validDate} from './journal';
import {sourceAmountMinor} from './evidence';
import {eligibleHistoricalSource} from './historical-analytics';
import {applySourceClassificationTx} from './source-classification';
import {postJournalTx,digest} from './use-cases';
import type {LedgerPort,LedgerTx} from './port';
export type HistoricalRefundInput={key:string;cardId:string;currency:Currency;originalSourceLineId:string;refundSourceLineId:string;accountId:string;purposeId:string;confirmedFullRefund:boolean;recordedAt:string};
/** A linked credit can follow a retained acquisition that predates the opening books. */
export function postHistoricalRefund(port:LedgerPort,input:HistoricalRefundInput):Promise<PostResult>{return port.transaction(tx=>postHistoricalRefundTx(tx,input));}
export async function postHistoricalRefundTx(tx:LedgerTx,input:HistoricalRefundInput):Promise<PostResult>{
 if(input.confirmedFullRefund!==true)throw new AccountingError('full_refund_confirmation_required');
 if(!input.key.trim()||!input.cardId.trim()||!validDate(input.recordedAt.slice(0,10))||!Number.isFinite(Date.parse(input.recordedAt)))throw new AccountingError('invalid_identity');
 const key=`historical-refund:${encodeURIComponent(input.refundSourceLineId)}`;
 const semanticInput={...input,key:''};
 const hash=digest(semanticInput),saved=await tx.reviewCommand(key);
 if(saved){if(saved.digest!==hash)throw new AccountingError('command_conflict');return {status:'duplicate',journalIds:[String(saved.payload.journalId)],reviewCode:null};}
 const original=await tx.sourceLine(input.originalSourceLineId),refund=await tx.sourceLine(input.refundSourceLineId);
 const originalRevision=original?await tx.sourceRevision(original.revisionId):null,refundRevision=refund?await tx.sourceRevision(refund.revisionId):null;
 if(!original||!refund||!originalRevision||!refundRevision||originalRevision.cardId!==input.cardId||refundRevision.cardId!==input.cardId||refundRevision.kind!=='statement'||refundRevision.admission!=='accepted')throw new AccountingError('historical_refund_source_mismatch');
 const opening=await tx.openingDate(input.cardId,input.currency),acquisition=eligibleHistoricalSource(original,originalRevision,opening);
 const p=refund.payload,amount=input.currency==='ARS'?p.ars:p.usd,other=input.currency==='ARS'?p.usd:p.ars;
 if(!acquisition||acquisition.currency!==input.currency||!opening||typeof p.date!=='string'||!validDate(p.date)||p.date<=opening||typeof amount!=='number'||amount>=0||other!=null&&other!==0||!['payments','purchases'].includes(String(p.section))||typeof p.description!=='string'||!/REEMBOLSO|DEVOLUCI[OÓ]N|REFUND/i.test(p.description))throw new AccountingError('historical_refund_evidence_mismatch');
 const amountMinor=sourceAmountMinor(-amount);
 if(amountMinor!==acquisition.minor)throw new AccountingError('full_refund_amount_mismatch');
 if((await tx.allPurchaseIdentities()).some(identity=>identity.sourceLineId===original.id))throw new AccountingError('refund_requires_posted_purchase_link');
 if((await tx.reviewDecisions(original.id)).some(d=>d.kind==='historical_refund'))throw new AccountingError('historical_purchase_already_refunded');
 await applySourceClassificationTx(tx,{sourceLineId:original.id,payload:{scope:'selected',accountId:input.accountId,purposeId:input.purposeId},recordedAt:input.recordedAt});
 const account=await tx.account(input.accountId);if(account?.type!=='expense')throw new AccountingError('unsupported_historical_refund_account');
 const journal:Journal={id:randomUUID(),commandKey:key,cardId:input.cardId,currency:input.currency,effectiveDate:p.date,recordedAt:input.recordedAt,kind:'credit',reversesId:null,evidenceIds:[refund.id,original.id],lines:[{accountId:`${input.cardId}:${input.currency}:billed`,debitMinor:amountMinor,creditMinor:0,purchaseId:null,purposeId:null},{accountId:input.accountId,debitMinor:0,creditMinor:amountMinor,purchaseId:null,purposeId:input.purposeId}]};
 const posted=await postJournalTx(tx,journal,hash);if(posted.status==='review')throw new AccountingError(posted.reviewCode??'historical_refund_review');
 const events=await tx.reviewEvents(refund.revisionId);
 for(const event of events.filter(e=>e.state==='open'&&e.sourceLineIds.includes(refund.id)&&!events.some(child=>child.priorDecisionId===e.id)))await tx.appendReviewEvent({...event,id:randomUUID(),priorDecisionId:event.id,state:'reviewed',params:{...event.params,resolution:'Verified full refund linked to retained original purchase',originalSourceLineId:original.id,refundJournalId:journal.id,accountId:input.accountId},recordedAt:input.recordedAt});
 await tx.appendReview({id:randomUUID(),key,digest:hash,subjectId:original.id,kind:'historical_refund',payload:{originalSourceLineId:original.id,refundSourceLineId:refund.id,journalId:journal.id,accountId:input.accountId,purposeId:input.purposeId,amountMinor,confirmedFullRefund:true,originalPurchaseDate:acquisition.effectiveDate,effectiveDate:p.date},priorDecisionId:(await tx.reviewDecisions(original.id)).at(-1)?.id??null,recordedAt:input.recordedAt,affectedIds:[original.id,refund.id,journal.id]});
 return posted;
}
