import { createHash, randomUUID } from "node:crypto";
import type { ReceiptExtraction, ReceiptFailure } from "@/lib/receipts/ingest";
import { MAX_RECEIPT_BYTES } from "@/lib/receipts/limits";
import { parseRows } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { verify } from "@/lib/receipts/verify";
import { matchReceiptProductsTx, type MatchSubject } from "./review";
import { reconcileReceiptTx } from "./linking";
import { AccountingError } from "./model";
import { retainSourceTx, sourceKey, sourceLineId, sourcePayloadDigest } from "./evidence";
import type { DocumentStore } from "./documents";
import type { EvidenceLedgerPort, ImportResult, ReceiptFacts } from "./evidence-port";
export type { ReceiptExtraction } from "@/lib/receipts/ingest";
export type ReceiptImportInput = { key: string; bytes: Buffer; extraction: ReceiptExtraction; correctedRowsText: string | null; recordedAt: string; appRevision?: string; legacyProductMatches?: {occurrence:number;productId:string;method:MatchSubject["method"];reviewed:boolean}[] };
const sha=(bytes:Buffer|string):string=>createHash("sha256").update(bytes).digest("hex");
export class ReceiptImportRejected extends AccountingError {
  constructor(readonly payload: ReceiptFailure, readonly sourceRevisionId: string) { super("verification_failed",{sourceRevisionId}); }
}
async function object(documents:DocumentStore,bytes:Buffer) {
  const ref=await documents.put(bytes);
  if(ref.sha256!==sha(bytes) || ref.relativePath!==ref.sha256 || !(await documents.read(ref)).equals(bytes)) throw new AccountingError("document_hash_mismatch");
  return {...ref,byteLength:bytes.byteLength};
}
/** Receipt admission persists evidence independently of whether payment/card identity is known. */
export async function importReceipt(port:EvidenceLedgerPort,documents:DocumentStore,input:ReceiptImportInput):Promise<ImportResult> {
  if(!input.key.trim()) throw new AccountingError("invalid_identity");
  if(input.bytes.byteLength>MAX_RECEIPT_BYTES) throw new AccountingError("receipt_too_large");
  if(input.bytes.subarray(0,5).toString("latin1")!=="%PDF-") throw new AccountingError("not_pdf");
  const appRevision=input.appRevision??process.env.ACCOUNTING_APP_REVISION;
  if(!appRevision?.trim()) throw new AccountingError("missing_app_revision");
  // Re-run the existing parser and exact verifier; a supplied 'ok' boolean cannot admit facts.
  const rowsText=input.correctedRowsText??input.extraction.rowsText;
  const parsed=parseRows(parseRowsText(rowsText)),report=verify(parsed),documentHash=sha(input.bytes);
  const sourceAmounts=[parsed.footer.subtotalCents,parsed.footer.discountsCents,parsed.footer.totalCents,parsed.header.paymentCents,...parsed.items.flatMap(i=>[i.lineTotalCents,i.unitPriceCents,...i.discounts.map(d=>d.amountCents)])].filter(n=>n!==null);
  const safeAmounts=sourceAmounts.every(n=>Number.isSafeInteger(n));
  const financialNature=parsed.footer.totalCents!==null && parsed.footer.totalCents>0;
  const fiscalId=parsed.header.fiscalNumber?`coto:${parsed.header.fiscalNumber}`:null;
  const rawPayload={parsed,report,scale:input.extraction.scale,originalRowsText:input.extraction.rowsText,correctedRowsText:input.correctedRowsText};
  const rawJson=Buffer.from(JSON.stringify(rawPayload));
  const pdf=await object(documents,input.bytes),raw=await object(documents,rawJson),originalRows=await object(documents,Buffer.from(input.extraction.rowsText));
  const correctedRows=input.correctedRowsText===null?null:await object(documents,Buffer.from(input.correctedRowsText));
  const commandKey=`source:${documentHash}:receipt:${encodeURIComponent(input.key)}`,digest=sourcePayloadDigest({rawPayload,legacyProductMatches:input.legacyProductMatches??null});
  const result=await port.transaction(async tx=>{
    const command=await tx.sourceImportCommand(commandKey);
    if(command) {
      if(command.digest!==digest) throw new AccountingError("command_conflict");
      return {...command.result,postedJournalIds:[],duplicate:true};
    }
    const key=sourceKey({cardId:null,kind:"receipt",documentHash,fiscalId,closingDate:null});
    const revisions=await tx.sourceRevisions(key);
    const previousScan=input.correctedRowsText!==null?await tx.sourceByDocument("receipt",documentHash):null;
    const latest=revisions.find(r=>!revisions.some(child=>child.previousRevisionId===r.id))??(previousScan?.admission==="rejected"?previousScan:null);
    const priorAccepted=revisions.find(r=>r.admission==="accepted");
    for(const ref of [pdf,raw,originalRows,...(correctedRows?[correctedRows]:[])]) await tx.appendSourceObject(ref);
    const retained=await retainSourceTx(tx,{key:input.key,cardId:null,kind:"receipt",documentHash,objectPath:pdf.relativePath,rawPayload,previousRevisionId:latest?.id??null,recordedAt:input.recordedAt,fiscalId,closingDate:null,rawObject:raw,appRevision,admission:!report.ok?"rejected":priorAccepted || !safeAmounts || !financialNature?"pending":"accepted"});
    const outcome:ImportResult={sourceRevisionId:retained.revisionId,purchaseIds:[],postedJournalIds:[],reviews:[],duplicate:retained.status==="duplicate"};
    if(retained.status!=="duplicate") {
      const previousFacts=latest?await tx.receiptFacts(latest.id):null;
      const acceptedFacts=priorAccepted?await tx.receiptFacts(priorAccepted.id):null;
      const receiptId=await tx.ensureReceiptEntity("coto",report.ok?fiscalId:null,documentHash,acceptedFacts?.receiptId??previousFacts?.receiptId);
      const facts:ReceiptFacts={revisionId:retained.revisionId,receiptId,chain:"coto",fiscalId,date:parsed.header.date,totalMinor:Number.isSafeInteger(parsed.footer.totalCents)?parsed.footer.totalCents:null,parsed,report,scale:input.extraction.scale,originalRowsObject:originalRows,correctedRowsObject:correctedRows,productReviewed:false};
      await tx.appendReceiptFacts(facts);
      for(let i=0;i<parsed.items.length;i++) await tx.appendSourceLine({id:sourceLineId(retained.revisionId,i+1),revisionId:retained.revisionId,occurrence:i+1,payload:{...parsed.items[i]},legacyFingerprint:null});
      const code=!report.ok?"verification_failed":!safeAmounts?"invalid_minor_units":!financialNature?"unsupported_financial_nature":priorAccepted?(priorAccepted.documentHash===documentHash?"receipt_revision_requires_review":"duplicate_fiscal_receipt"):null;
      if (code) {
        const review={code,params:{},sourceLineIds:[]};outcome.reviews.push(review);
        await tx.appendReviewEvent({...review,id:randomUUID(),subjectId:retained.revisionId,priorDecisionId:null,state:"open",recordedAt:input.recordedAt});
      }
    } else outcome.reviews=(await tx.reviewEvents(retained.revisionId)).map(({code,params,sourceLineIds})=>({code,params,sourceLineIds}));
    const revision=await tx.sourceRevision(retained.revisionId);
    if (report.ok && revision?.admission==="accepted") {
      if (input.legacyProductMatches !== undefined && retained.status!=="duplicate") {
        const sourceLines=await tx.sourceLines(retained.revisionId), matches=input.legacyProductMatches;
        if(matches.length!==sourceLines.length || new Set(matches.map(m=>m.occurrence)).size!==matches.length) throw new AccountingError("invalid_legacy_product_matches");
        for(const match of matches) {
          const line=sourceLines.find(l=>l.occurrence===match.occurrence), product=await tx.reviewSubject("product",match.productId);
          if(!line || product?.kind!=="product" || product.redirectId!==null || !["code","rule","manual","auto"].includes(match.method) || typeof match.reviewed!=="boolean") throw new AccountingError("invalid_legacy_product_matches");
          await tx.appendReviewSubject({kind:"match",id:line.id,receiptRevisionId:retained.revisionId,sourceLineId:line.id,productId:match.productId,method:match.method,reviewed:match.reviewed});
        }
      } else if(input.legacyProductMatches===undefined) await matchReceiptProductsTx(tx,retained.revisionId);
      const reconciled=await reconcileReceiptTx(tx,{key:`import:${input.key}`,receiptRevisionId:retained.revisionId,cardId:null,paymentVerified:false,purchaseId:null,allocation:null,recordedAt:input.recordedAt});
      outcome.purchaseIds=reconciled.purchaseIds;outcome.postedJournalIds=reconciled.postedJournalIds;outcome.reviews=reconciled.reviews;
    }
    await tx.appendSourceImportCommand({key:commandKey,digest,result:outcome});return outcome;
  });
  // Throw only after rejected evidence commits. No rejected attempt becomes a purchase.
  if(!report.ok) throw new ReceiptImportRejected({report,rowsText,sha256:documentHash,scale:input.extraction.scale},result.sourceRevisionId);
  return result;
}

/** Bridge the extraction seam's best failed attempt to durable pending evidence without OCR. */
export async function retainRejectedReceipt(port:EvidenceLedgerPort,documents:DocumentStore,input:{key:string;bytes:Buffer;rejection:ReceiptFailure;recordedAt:string;appRevision?:string}):Promise<never> {
  if(sha(input.bytes)!==input.rejection.sha256) throw new AccountingError("document_hash_mismatch");
  const parsed=parseRows(parseRowsText(input.rejection.rowsText));
  await importReceipt(port,documents,{...input,extraction:{parsed,rowsText:input.rejection.rowsText,report:verify(parsed),scale:input.rejection.scale},correctedRowsText:null});
  throw new AccountingError("rejection_report_conflict");
}
