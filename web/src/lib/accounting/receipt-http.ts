import { createHash,randomUUID } from "node:crypto";
import type { AccountingContext } from "@/lib/backend";
import { Failure } from "@/lib/failure";
import { extractReceipt, ReceiptRejected,validateReceiptBytes } from "@/lib/receipts/ingest";
import { renderPages } from "@/lib/receipts/pdf";
import { ocrPages } from "@/lib/receipts/ocr";
import { parseRowsText } from "@/lib/receipts/rows";
import { parseRows } from "@/lib/receipts/parse";
import { verify } from "@/lib/receipts/verify";
import { importReceipt, retainRejectedReceipt } from "./receipt-import";
import { AccountingError } from "./model";
export async function storedReceiptResponse(context:AccountingContext,sourceRevisionId:string) {
  return context.ledger.transaction(async tx=>{
    const facts=await tx.receiptFacts(sourceRevisionId);if(!facts)throw new AccountingError("missing_receipt_facts");
    return {id:facts.receiptId,date:facts.date!,totalCents:facts.totalMinor!,items:facts.parsed.items.length,report:facts.report,sourceRevisionId};
  });
}
export async function uploadAccountingReceipt(context:AccountingContext,bytes:Buffer) {
  validateReceiptBytes(bytes);
  const hash=createHash("sha256").update(bytes).digest("hex");
  const existing=await context.ledger.transaction(async tx=>{
    const source=await tx.sourceByDocument("receipt",hash);if(source?.admission!=="accepted")return null;
    const facts=await tx.receiptFacts(source.id),object=await tx.sourceObject(hash);
    if(!facts)throw new AccountingError("missing_receipt_facts");if(!object)throw new AccountingError("document_missing");
    return {facts,object};
  });
  if(existing){await context.documents.read(existing.object);throw new Failure("duplicate_receipt","failure.duplicate_receipt.file",{id:existing.facts.receiptId,date:existing.facts.date!});}

  const common={key:randomUUID(),bytes,recordedAt:new Date().toISOString(),appRevision:context.appRevision};
  let extraction;
  try {extraction=await extractReceipt(bytes,{renderPages,ocr:ocrPages});}
  catch(error){if(error instanceof ReceiptRejected)return retainRejectedReceipt(context.ledger,context.documents,{...common,rejection:error.payload});throw error;}
  const result=await importReceipt(context.ledger,context.documents,{...common,extraction,correctedRowsText:null});
  return {...await storedReceiptResponse(context,result.sourceRevisionId),reviews:result.reviews};
}
export async function correctAccountingReceipt(context:AccountingContext,sha256:string,rowsText:string) {
  if(!/^[a-f0-9]{64}$/.test(sha256))throw new Failure("pending_missing","failure.pending_missing");
  if(parseRowsText(rowsText).length===0)throw new Failure("bad_rows","failure.bad_rows");
  const pending=await context.ledger.transaction(async tx=>{
    const source=await tx.sourceByDocument("receipt",sha256);if(!source)return null;
    const facts=await tx.receiptFacts(source.id),object=await tx.sourceObject(sha256);return facts&&object?{source,facts,object}:null;
  });
  if(!pending)throw new Failure("pending_missing","failure.pending_missing");
  const bytes=await context.documents.read(pending.object),originalRows=(await context.documents.read(pending.facts.originalRowsObject)).toString("utf8"),parsed=parseRows(parseRowsText(originalRows));
  const result=await importReceipt(context.ledger,context.documents,{key:randomUUID(),bytes,extraction:{parsed,rowsText:originalRows,report:verify(parsed),scale:pending.facts.scale},correctedRowsText:rowsText,recordedAt:new Date().toISOString(),appRevision:context.appRevision});
  return {...await storedReceiptResponse(context,result.sourceRevisionId),reviews:result.reviews};
}
