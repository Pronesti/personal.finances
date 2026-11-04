"use server";
import { randomUUID } from "node:crypto";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { reconcileReceipt, unlinkReceipt as unlinkAccountingReceipt } from "@/lib/accounting/linking";
import { recordHistoricalAssociation } from "@/lib/accounting/historical-links";
import { historicalSourceLineId } from "@/lib/accounting/receipt-ui";
import { receiptRevisionForId } from "@/lib/accounting/receipt-ui";
import { linkReceipt, unlinkReceipt } from "@/lib/receipts/charges";

// Links are shown on this page, on the receipt detail and in the categories drill table, so the
// whole tree is revalidated. Bad input is ignored: the page re-renders unchanged. The library
// call can throw (a taken charge, a stale form) and is caught so the page re-renders unchanged.
export async function linkChargeAction(formData: FormData): Promise<void> {
  const receiptValue=String(formData.get("receipt")??""),receipt = Number(receiptValue.split("|")[0]);
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if(selectedBackend()==="postgres") {
    if(!Number.isSafeInteger(receipt)||receipt<1||!fingerprint.trim())return;
    const sourceLineId=historicalSourceLineId(fingerprint);
    if(sourceLineId){await withAccounting(async({ledger})=>{const facts=await ledger.transaction(tx=>receiptRevisionForId(tx,receipt));if(!facts)return;await recordHistoricalAssociation(ledger,{key:randomUUID(),receiptRevisionId:facts.revisionId,sourceLineId,action:"link",expectedPreviousDecisionId:String(formData.get("historicalPreviousDecisionId")??receiptValue.split("|")[1]??"")||null,method:"manual",recordedAt:new Date().toISOString()});});revalidatePath("/","layout");return;}
    await withAccounting(async({ledger})=>{const facts=await ledger.transaction(tx=>receiptRevisionForId(tx,receipt));if(!facts)return;await reconcileReceipt(ledger,{key:randomUUID(),receiptRevisionId:facts.revisionId,cardId:null,paymentVerified:false,purchaseId:fingerprint,allocation:null,recordedAt:new Date().toISOString()});});
    revalidatePath("/","layout");return;
  }
  if (!Number.isInteger(receipt) || !/^[0-9a-f]{40}$/.test(fingerprint)) return;
  try {
    linkReceipt(getDb(), receipt, fingerprint, "manual");
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}

export async function unlinkChargeAction(formData: FormData): Promise<void> {
  const receipt = Number(formData.get("receipt"));
  if (!Number.isInteger(receipt)) return;
  if(selectedBackend()==="postgres") {
    if(formData.get("historical")==="yes"){await withAccounting(async({ledger})=>{const facts=await ledger.transaction(tx=>receiptRevisionForId(tx,receipt));if(!facts)return;await recordHistoricalAssociation(ledger,{key:randomUUID(),receiptRevisionId:facts.revisionId,sourceLineId:null,action:"unlink",expectedPreviousDecisionId:String(formData.get("historicalPreviousDecisionId")??"")||null,method:"manual",recordedAt:new Date().toISOString()});});revalidatePath("/","layout");return;}
    await withAccounting(async({ledger})=>{const facts=await ledger.transaction(tx=>receiptRevisionForId(tx,receipt));if(facts)await unlinkAccountingReceipt(ledger,{key:randomUUID(),receiptRevisionId:facts.revisionId,recordedAt:new Date().toISOString()});});
    revalidatePath("/","layout");return;
  }
  unlinkReceipt(getDb(), receipt);
  revalidatePath("/", "layout");
}
