import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./documents";
import { syntheticSeed } from "./test-support";
import { importReceipt, ReceiptImportRejected, type ReceiptImportInput } from "./receipt-import";
import { receiptExtraction } from "./receipt-test-support";
const input=(overrides:Partial<ReceiptImportInput>={}):ReceiptImportInput=>({key:"r1",bytes:Buffer.from("%PDF-synthetic-receipt"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test",...overrides});
const ledger=()=>createMemoryLedger(syntheticSeed());

describe("receipt evidence admission",()=>{
  it("retains a verified 8000-cent receipt independently of unknown card/payment and product approval",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),source=input();
    expect(source.extraction.report.ok).toBe(true);
    const result=await importReceipt(port,docs,source);
    expect(result.reviews.map(r=>r.code)).toContain("receipt_payment_unresolved");
    expect(await port.journals("card-a")).toEqual([]);
    await port.transaction(async tx=>{
      const facts=await tx.receiptFacts(result.sourceRevisionId);
      expect(facts?.receiptId).toBe(1);expect(facts?.totalMinor).toBe(8000);expect(facts?.productReviewed).toBe(false);
      expect(facts?.parsed.items[0].discounts[0].amountCents).toBe(-2000);
      expect(await docs.read(facts!.originalRowsObject)).toEqual(Buffer.from(source.extraction.rowsText));
      expect(await tx.acceptedReceipts()).toHaveLength(1);
    });
  });
  it("persists a one-cent rejection without accepted facts or journals, then preserves corrected evidence",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),broken=receiptExtraction({totalCents:8001});
    let rejected!:ReceiptImportRejected;
    try{await importReceipt(port,docs,input({extraction:broken}));}catch(e){rejected=e as ReceiptImportRejected;}
    expect(rejected.code).toBe("verification_failed");expect(rejected.payload.report.ok).toBe(false);
    expect(await port.journals("card-a")).toEqual([]);
    await port.transaction(async tx=>{expect(await tx.acceptedReceipts()).toEqual([]);expect((await tx.sourceRevision(rejected.sourceRevisionId))?.admission).toBe("rejected");});
    const corrected=await importReceipt(port,docs,input({key:"corrected",extraction:broken,correctedRowsText:receiptExtraction().rowsText}));
    await port.transaction(async tx=>{
      const facts=await tx.receiptFacts(corrected.sourceRevisionId);
      expect(facts?.receiptId).toBe(1);expect(facts?.report.ok).toBe(true);
      expect(await docs.read(facts!.originalRowsObject)).toEqual(Buffer.from(broken.rowsText));
      expect(await docs.read(facts!.correctedRowsObject!)).toEqual(Buffer.from(receiptExtraction().rowsText));
      expect((await tx.sourceRevision(corrected.sourceRevisionId))?.previousRevisionId).toBe(rejected.sourceRevisionId);
    });
  });
  it("deduplicates bytes and fiscal identity separately without a second accepted entity",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),first=await importReceipt(port,docs,input());
    const duplicate=await importReceipt(port,docs,input({key:"rename"}));
    expect(duplicate.sourceRevisionId).toBe(first.sourceRevisionId);expect(duplicate.duplicate).toBe(true);
    const scan=await importReceipt(port,docs,input({key:"rescan",bytes:Buffer.from("%PDF-rescanned-same-fiscal")}));
    expect(scan.reviews.map(r=>r.code)).toContain("duplicate_fiscal_receipt");
    await port.transaction(async tx=>{
      expect(await tx.acceptedReceipts()).toHaveLength(1);
      expect((await tx.receiptFacts(scan.sourceRevisionId))?.receiptId).toBe((await tx.receiptFacts(first.sourceRevisionId))?.receiptId);
      expect((await tx.sourceRevision(scan.sourceRevisionId))?.admission).toBe("pending");
    });
  });
  it("rejects a forged report and corrects a missing fiscal ID while retaining numeric identity",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),bad=receiptExtraction({totalCents:8001});bad.report={...bad.report,ok:true};
    await expect(importReceipt(port,docs,input({extraction:bad}))).rejects.toThrow("verification_failed");
    const missing=receiptExtraction();missing.rowsText=missing.rowsText.replace(/NRO.T.:0001-00000001/,"UNKNOWN FISCAL");
    let prior!:ReceiptImportRejected;
    const other=ledger();
    try{await importReceipt(other,docs,input({extraction:missing}));}catch(e){prior=e as ReceiptImportRejected;}
    const corrected=await importReceipt(other,docs,input({key:"fix-fiscal",extraction:missing,correctedRowsText:receiptExtraction().rowsText}));
    await other.transaction(async tx=>{
      expect((await tx.receiptFacts(prior.sourceRevisionId))?.receiptId).toBe((await tx.receiptFacts(corrected.sourceRevisionId))?.receiptId);
      expect((await tx.sourceRevision(corrected.sourceRevisionId))?.previousRevisionId).toBe(prior.sourceRevisionId);
    });
  });
});
