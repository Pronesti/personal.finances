"use server";
import { historicalProposalMerchants } from "@/lib/accounting/merchant-proposals";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withAccounting } from "@/lib/backend";
import { classifyPurchase, applyReview, registerProposalTx, type MerchantSubject, type MerchantPurchaseSubject, type ProposalSubject, type RejectionSubject } from "@/lib/accounting/review";
import { classifyMerchants, MAX_BATCH } from "@/lib/llm";
import { AccountingError } from "@/lib/accounting/model";
export async function classifyAccountingPurchaseAction(form:FormData):Promise<void>{
  const scope=String(form.get("scope")??"selected");if(!["selected","future_rule","matching_history"].includes(scope))throw new AccountingError("invalid_classification_scope");
  if(scope==="matching_history" && form.get("confirmed")!=="on")throw new AccountingError("history_confirmation_required");
  let confirmedPurchaseIds:string[]|undefined;
  if(scope==="matching_history"){const ids=JSON.parse(String(form.get("confirmedPurchaseIds")??"[]")) as unknown;if(!Array.isArray(ids)||ids.some(id=>typeof id!=="string"))throw new AccountingError("invalid_history_confirmation");confirmedPurchaseIds=ids as string[];}
  await withAccounting(async({ledger})=>{
    const accountId=String(form.get("accountId")??""),account=await ledger.transaction(tx=>tx.account(accountId));if(!account)throw new AccountingError("missing_account");
    await classifyPurchase(ledger,{key:randomUUID(),cardId:String(form.get("cardId")??""),purchaseId:String(form.get("purchaseId")??""),accountId,purposeId:account.primaryPurposeId??"unallocated",scope:scope as "selected"|"future_rule"|"matching_history",match:String(form.get("match")??"").trim()||null,confirmedPurchaseIds,recordedAt:new Date().toISOString()});
  });revalidatePath("/","layout");
}
export async function rejectAccountingProposalAction(form:FormData):Promise<void>{
  await withAccounting(({ledger})=>applyReview(ledger,{key:randomUUID(),subjectId:String(form.get("proposalId")??""),kind:"proposal_reject",payload:{sanitizedMerchant:String(form.get("sanitizedMerchant")??"")},recordedAt:new Date().toISOString()}));revalidatePath("/review");
}
export async function acceptAccountingProposalAction(form:FormData):Promise<void>{
  const scope=String(form.get("scope")??"selected");if(scope==="matching_history")throw new AccountingError("history_confirmation_required");
  await withAccounting(async({ledger})=>{
    const accountId=String(form.get("accountId")??""),account=await ledger.transaction(tx=>tx.account(accountId));if(!account)throw new AccountingError("missing_account");
    await applyReview(ledger,{key:String(form.get("key")??randomUUID()),subjectId:String(form.get("proposalId")??""),kind:"proposal_accept",payload:{cardId:String(form.get("cardId")??""),purchaseId:String(form.get("purchaseId")??""),accountId,purposeId:account.primaryPurposeId??"unallocated",scope,match:String(form.get("match")??"")},recordedAt:new Date().toISOString()});
  });revalidatePath("/","layout");
}
export async function proposeAccountingMerchantCategories():Promise<number>{
  return withAccounting(async({ledger,reader})=>{
    const historical=historicalProposalMerchants(await reader.facts());
    const pending=await ledger.transaction(async tx=>{
      const merchants=await tx.reviewSubjects("merchant") as MerchantSubject[];
      const verifiedHistorical=new Set<string>();
      for(const candidate of historical){if(!await tx.sourceLine(candidate.sourceLineId))continue;verifiedHistorical.add(candidate.id);if(!merchants.some(m=>m.id===candidate.id)){const merchant:MerchantSubject={kind:"merchant",id:candidate.id,normalizedName:candidate.normalizedName,redirectId:null};await tx.appendReviewSubject(merchant);merchants.push(merchant);}}
      const proposals=await tx.reviewSubjects("proposal") as ProposalSubject[],rejections=await tx.reviewSubjects("rejection") as RejectionSubject[];
      const eligible=new Set<string>(verifiedHistorical);for(const association of await tx.reviewSubjects("merchant_purchase") as MerchantPurchaseSubject[]){const purchase=await tx.purchase(association.purchaseId);if(!purchase?.allocations.some(a=>a.accountId==="expense:unallocated"))continue;let merchant=merchants.find(m=>m.id===association.merchantId);const seen=new Set<string>();while(merchant?.redirectId&&!seen.has(merchant.id)){seen.add(merchant.id);merchant=merchants.find(m=>m.id===merchant!.redirectId);}if(merchant)eligible.add(merchant.id);}
      return merchants.filter(m=>eligible.has(m.id)&&!m.redirectId&&!proposals.some(p=>p.merchantId===m.id&&p.state!=="rejected")&&!rejections.some(r=>r.merchantId===m.id)).slice(0,MAX_BATCH);
    });
    if(!pending.length)return 0;
    // Existing classifier receives only current sanitized merchant-name payloads, never source lines.
    const proposals=await classifyMerchants(pending.map(m=>m.normalizedName));let count=0;
    await ledger.transaction(async tx=>{for(const proposal of proposals){const merchant=pending.find(m=>m.normalizedName===proposal.merchant);if(!merchant)continue;if(await registerProposalTx(tx,{kind:"proposal",id:randomUUID(),merchantId:merchant.id,sanitizedMerchant:proposal.sent,state:"pending",evidence:{sent:proposal.sent,confidence:proposal.confidence,legacyCategory:proposal.category,legacySubcategory:proposal.subcategory}}))count++;}});
    return count;
  });
}
