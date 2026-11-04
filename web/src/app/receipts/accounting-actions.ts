"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withAccounting } from "@/lib/backend";
import { reconcileReceipt } from "@/lib/accounting/linking";
import { reviewReceiptItem } from "@/lib/accounting/review";
import { sourceLineId } from "@/lib/accounting/evidence";
import { AccountingError } from "@/lib/accounting/model";
export async function recordReceiptPurchaseAction(form:FormData):Promise<void>{
  const receiptRevisionId=String(form.get("receiptRevisionId")??""),cardId=String(form.get("cardId")??"");
  await withAccounting(({ledger})=>reconcileReceipt(ledger,{key:randomUUID(),receiptRevisionId,cardId:cardId||null,paymentVerified:form.get("paymentVerified")==="on",purchaseId:null,allocation:null,recordedAt:new Date().toISOString()}));
  revalidatePath("/","layout");
}
export async function reviewReceiptProductAction(form:FormData):Promise<void>{
  const productId=String(form.get("productId")??"");if(!/^[1-9]\d*$/.test(productId))throw new AccountingError("invalid_product_id");
  await withAccounting(({ledger})=>reviewReceiptItem(ledger,{key:randomUUID(),receiptRevisionId:String(form.get("receiptRevisionId")??""),sourceLineId:String(form.get("sourceLineId")??""),productId,recordedAt:new Date().toISOString()}));
  revalidatePath("/","layout");
}
export async function allocateReceiptItemsAction(form:FormData):Promise<void>{
  const receiptRevisionId=String(form.get("receiptRevisionId")??"");
  await withAccounting(async({ledger})=>{
    const itemAllocations=await ledger.transaction(async tx=>{
      const receipt=await tx.receiptFacts(receiptRevisionId);if(!receipt)throw new AccountingError("missing_receipt_facts");
      const result=[];for(let i=0;i<receipt.parsed.items.length;i++){
        const id=sourceLineId(receiptRevisionId,i+1),accountId=String(form.get(`account:${Buffer.from(id).toString("base64url")}`) ?? form.get(`account:${encodeURIComponent(id)}`) ?? form.get(`account:${encodeURIComponent(id).replace(/%22/g, '"')}`) ?? "");if(!accountId)continue;
        const account=await tx.account(accountId);if(!account)throw new AccountingError("missing_account");
        const item=receipt.parsed.items[i],minor=item.lineTotalCents!+item.discounts.reduce((s,d)=>s+d.amountCents,0);
        result.push({sourceLineId:id,accountId,purposeId:account.primaryPurposeId??"unallocated",minor});
      }return result;
    });
    await reconcileReceipt(ledger,{key:randomUUID(),receiptRevisionId,cardId:null,paymentVerified:false,purchaseId:null,allocation:null,itemAllocations,recordedAt:new Date().toISOString()});
  });revalidatePath("/","layout");
}
