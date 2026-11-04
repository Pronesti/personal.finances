import { describe, expect, it } from "vitest";
import { withTestLedger } from "./test-support";
import { seedActualCatalogCards } from "./catalog-service";
import { createMemoryDocuments } from "./documents";
import { importReceipt, ReceiptImportRejected } from "./receipt-import";
import { receiptExtraction } from "./receipt-test-support";
import { reconcileReceipt } from "./linking";
import { importStatement } from "./statement-import";
import type { LedgerPort, LedgerTx } from "./port";
const enabled=process.env.ACCOUNTING_PG_TESTS==="1",now="2026-02-01T12:00:00Z",bytes=Buffer.from("%PDF-synthetic-pg-receipt");
const receiptInput=()=>({key:"r1",bytes,extraction:receiptExtraction(),correctedRowsText:null,recordedAt:now,appRevision:"synthetic:integration-test"});
describe.skipIf(!enabled)("PostgreSQL verified receipts and one purchase",()=>{
  it("commits rejected evidence, preserves both transcripts and stable database receipt identity after correction",async()=>{
    await withTestLedger(async port=>{
      await seedActualCatalogCards(port,[{id:"card-a",displayName:"Synthetic card"}]);const docs=createMemoryDocuments(),bad=receiptExtraction({totalCents:8001});let rejection!:ReceiptImportRejected;
      try{await importReceipt(port,docs,{...receiptInput(),extraction:bad});}catch(e){rejection=e as ReceiptImportRejected;}
      expect(rejection.code).toBe("verification_failed");expect(await port.journals("card-a")).toEqual([]);
      const corrected=await importReceipt(port,docs,{...receiptInput(),key:"corrected",extraction:bad,correctedRowsText:receiptExtraction().rowsText});
      await port.transaction(async tx=>{
        const old=await tx.receiptFacts(rejection.sourceRevisionId),current=await tx.receiptFacts(corrected.sourceRevisionId);
        expect(current?.receiptId).toBe(old?.receiptId);expect(Number.isSafeInteger(current?.receiptId)).toBe(true);
        expect(await docs.read(current!.originalRowsObject)).toEqual(Buffer.from(bad.rowsText));
        expect(await docs.read(current!.correctedRowsObject!)).toEqual(Buffer.from(receiptExtraction().rowsText));
        expect(await tx.acceptedReceipts()).toHaveLength(1);
        expect((await tx.reviewSubjects("product")).length).toBeGreaterThan(0);
      });
    },{seed:false});
  },20000);
  it("posts a supported receipt once, then uses later statement evidence only to bill that purchase",async()=>{
    await withTestLedger(async port=>{
      await seedActualCatalogCards(port,[{id:"card-a",displayName:"Synthetic card"}]);const docs=createMemoryDocuments(),r=await importReceipt(port,docs,receiptInput());
      const posted=await reconcileReceipt(port,{key:"proof",receiptRevisionId:r.sourceRevisionId,cardId:"card-a",paymentVerified:true,purchaseId:null,allocation:null,recordedAt:now});
      const json={file:"synthetic_2026.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"MERPAGO*COTO",ars:80,usd:null,installment_number:null,installment_count:null}]};
      const s=await importStatement(port,docs,{key:"statement",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic-pg-statement"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:now,appRevision:"synthetic:integration-test"});
      expect(s.purchaseIds).toEqual(posted.purchaseIds);
      const journals=await port.journals("card-a");expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);expect(journals.filter(j=>j.kind==="billing")).toHaveLength(1);
    },{seed:false});
  },20000);
  it("rolls back a failed financial/link transaction without losing accepted receipt evidence",async()=>{
    await withTestLedger(async port=>{
      await seedActualCatalogCards(port,[{id:"card-a",displayName:"Synthetic card"}]);const docs=createMemoryDocuments(),r=await importReceipt(port,docs,receiptInput());
      const failing:LedgerPort={journals:id=>port.journals(id),transaction:<T>(work:(tx:LedgerTx)=>Promise<T>)=>port.transaction(tx=>work({...tx,appendReceiptLinkDecision:async()=>{throw new Error("simulated link failure");}}))};
      const command={key:"proof",receiptRevisionId:r.sourceRevisionId,cardId:"card-a",paymentVerified:true,purchaseId:null,allocation:null,recordedAt:now};
      await expect(reconcileReceipt(failing,command)).rejects.toMatchObject({code:"ledger_transaction_failed",params:{reason:"simulated link failure"}});
      expect(await port.journals("card-a")).toEqual([]);
      await port.transaction(async tx=>{expect(await tx.acceptedReceipts()).toHaveLength(1);expect(await tx.receiptLinkDecisions(r.sourceRevisionId)).toEqual([]);});
      expect((await reconcileReceipt(port,command)).purchaseIds).toHaveLength(1);
      expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
    },{seed:false});
  },20000);
});
