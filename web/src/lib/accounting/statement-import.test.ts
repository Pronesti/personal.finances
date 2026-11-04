import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./documents";
import { syntheticSeed } from "./test-support";
import { importStatement, statementMinor, type StatementImportInput } from "./statement-import";
import type { EvidenceLedgerPort } from "./evidence-port";
import type { StatementJson } from "@/lib/integrity";
import { fixture } from "@/lib/__fixtures__/statement";
import { postJournal } from "./use-cases";

function input(overrides: Partial<StatementImportInput> = {}): StatementImportInput {
  const json: StatementJson = {file:"synthetic_2026_07.pdf",brand:"visa",period:{closing_date:"2026-07-30"},balances:{current_ars:100},declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:100,usd:null}],upcoming_installments:[{month:"2026-08",amount_ars:0}],transactions:[{section:"purchases",block:1,date:"2026-07-10",description:"SYNTHETIC SHOP",ars:100,usd:null,installment_number:null,installment_count:null}]};
  const result = {key:"a",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic-statement"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-08-01T12:00:00Z",appRevision:"synthetic:test",...overrides};
  if (overrides.json && !overrides.rawJson) result.rawJson=Buffer.from(JSON.stringify(overrides.json));
  return result;
}
const ledger = () => createMemoryLedger(syntheticSeed()) as EvidenceLedgerPort;

describe("statement admission", () => {
  it("retains newly discovered pre-opening evidence without duplicating the opening debt", async () => {
    const port = ledger();
    await postJournal(port, { id: "opening", commandKey: "opening", cardId: "card-a", currency: "ARS", effectiveDate: "2026-08-01", recordedAt: "2026-08-02T12:00:00Z", kind: "opening", reversesId: null, evidenceIds: ["synthetic:e1"], lines: [
      { accountId: "equity:opening", debitMinor: 10000, creditMinor: 0, purchaseId: null, purposeId: null },
      { accountId: "card-a:ARS:billed", debitMinor: 0, creditMinor: 10000, purchaseId: null, purposeId: null },
    ] }, "synthetic-opening-digest");
    const result = await importStatement(port, createMemoryDocuments(), input());
    expect(result.reviews).toMatchObject([{ code: "historical_source_requires_opening_reconciliation", params: { currency: "ARS", openingDate: "2026-08-01" } }]);
    expect(result.postedJournalIds).toEqual([]);
    expect((await port.journals("card-a")).map(journal => journal.kind)).toEqual(["opening"]);
    expect(await port.transaction(tx => tx.sourceLines(result.sourceRevisionId))).toHaveLength(1);
  });
  it("renamed identical uploads retain one revision and purchase without a second posting", async () => {
    const port=ledger(), docs=createMemoryDocuments(), firstInput=input();
    const first=await importStatement(port,docs,firstInput);
    const again=await importStatement(port,docs,input({key:"b",filename:"renamed.pdf",json:{...firstInput.json,file:"renamed.pdf"}}));
    expect(again.sourceRevisionId).toBe(first.sourceRevisionId);
    expect(again.duplicate).toBe(true); expect(again.postedJournalIds).toEqual([]);
    expect(first.purchaseIds).toHaveLength(1);
    const journals=await port.journals("card-a");
    expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);
    expect(journals.filter(j=>j.kind==="billing")).toHaveLength(1);
    await port.transaction(async tx=>{
      const revision=await tx.sourceRevision(first.sourceRevisionId);
      expect(revision?.appRevision).toBe("synthetic:test");
      expect(await docs.read(revision!.rawObject!)).toEqual(firstInput.rawJson);
      expect(await tx.sourceLines(first.sourceRevisionId)).toHaveLength(1);
    });
  });
  it("retains the existing sanitized fixture without inventing installment principal or linked credits", async () => {
    const port=ledger(), docs=createMemoryDocuments();
    const result=await importStatement(port,docs,input({json:fixture,filename:fixture.file}));
    expect(result.reviews.map(r=>r.code)).toEqual(expect.arrayContaining(["unlinked_credit","missing_installment_history","missing_effective_date"]));
    expect(result.purchaseIds).toHaveLength(2);
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(2);
    await port.transaction(async tx=>{
      const lines=await tx.sourceLines(result.sourceRevisionId);
      expect(lines.map(l=>l.payload)).toEqual(fixture.transactions);
      expect(lines.every(l=>l.legacyFingerprint)).toBe(true);
    });
  });
  it("keeps equal printed occurrences as separate purchases", async () => {
    const port=ledger(), base=input();
    const json={...base.json,balances:{current_ars:200},declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:200,usd:null}],transactions:[base.json.transactions[0],base.json.transactions[0]]};
    const result=await importStatement(port,createMemoryDocuments(),input({json}));
    expect(result.purchaseIds).toHaveLength(2);
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(2);
  });
  it("retains revised extraction of the same PDF as pending and never reactivates prior bytes", async () => {
    const port=ledger(), docs=createMemoryDocuments(), original=input();
    const first=await importStatement(port,docs,original);
    const changed={...original.json,balances:{current_ars:101},declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:101,usd:null}],transactions:[{...original.json.transactions[0],ars:101}]};
    const revision=await importStatement(port,docs,input({key:"corrected",json:changed}));
    expect(revision.sourceRevisionId).not.toBe(first.sourceRevisionId);
    expect(revision.reviews.map(r=>r.code)).toContain("source_revision_requires_review");
    expect(revision.postedJournalIds).toEqual([]);
    const old=await importStatement(port,docs,input({key:"old-retry"}));
    expect(old.sourceRevisionId).toBe(first.sourceRevisionId); expect(old.duplicate).toBe(true);
    await port.transaction(async tx=>{
      expect((await tx.sourceRevision(first.sourceRevisionId))?.admission).toBe("accepted");
      expect((await tx.sourceRevision(revision.sourceRevisionId))?.admission).toBe("pending");
      expect((await tx.sourceRevision(revision.sourceRevisionId))?.previousRevisionId).toBe(first.sourceRevisionId);
      expect((await tx.currentStatementRevision("card-a"))?.id).toBe(first.sourceRevisionId);
      expect((await tx.statementFacts(first.sourceRevisionId))?.schedules).toEqual(original.json.upcoming_installments);
    });
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
  });
  it("keeps a changed closing date from the same PDF pending rather than recognizing another purchase",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),original=input(),first=await importStatement(port,docs,original);
    const observed=await importStatement(port,docs,input({key:"new-date",json:{...original.json,period:{closing_date:"2026-02-28"}}}));
    expect(observed.reviews.map(r=>r.code)).toContain("source_revision_requires_review");
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
    await port.transaction(async tx=>expect((await tx.sourceRevision(observed.sourceRevisionId))?.previousRevisionId).toBe(first.sourceRevisionId));
  });
  it("rejects conflicting request keys and serializes concurrent equal uploads", async () => {
    const port=ledger(), docs=createMemoryDocuments();
    const [a,b]=await Promise.all([importStatement(port,docs,input()),importStatement(port,docs,input())]);
    expect(a.sourceRevisionId).toBe(b.sourceRevisionId);
    expect([a.duplicate,b.duplicate].sort()).toEqual([false,true]);
    await expect(importStatement(port,docs,input({pdf:Buffer.from("%PDF-changed")}))).rejects.toThrow("command_conflict");
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
  });
  it("admits no financial facts for mismatched totals or incomplete installment principal", async () => {
    const port=ledger(), base=input();
    const result=await importStatement(port,createMemoryDocuments(),input({json:{...base.json,declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:100.01,usd:null}]}}));
    expect(result.reviews.map(r=>r.code)).toContain("statement_totals_conflict");
    expect(await port.journals("card-a")).toEqual([]);
    const installments=ledger();
    const missing=await importStatement(installments,createMemoryDocuments(),input({json:{...base.json,transactions:[{...base.json.transactions[0],installment_number:1,installment_count:6}]}}));
    expect(missing.reviews.map(r=>r.code)).toContain("missing_supported_principal");
    expect(await installments.journals("card-a")).toEqual([]);
  });
  it("rolls source facts back with a failed financial write and reuses immutable objects on retry", async () => {
    const seed=syntheticSeed(); seed.accounts=seed.accounts.filter(a=>a.id!=="expense:unallocated");
    const port=createMemoryLedger(seed) as EvidenceLedgerPort, docs=createMemoryDocuments();
    await expect(importStatement(port,docs,input())).rejects.toThrow("invalid_posting_account");
    expect(await port.journals("card-a")).toEqual([]);
    await port.transaction(async tx=>expect(await tx.sourceByDocument("statement",(await docs.put(input().pdf)).sha256)).toBeNull());
    const retry=await importStatement(ledger(),docs,input());
    expect(retry.purchaseIds).toHaveLength(1);
  });
  it.each(["mastercard","mercadopago"])("retains supported %s issuer evidence with explicit card identity", async brand => {
    const base=input(),port=ledger();
    const result=await importStatement(port,createMemoryDocuments(),input({json:{...base.json,brand}}));
    expect(result.purchaseIds).toHaveLength(1);
    expect(result.reviews).toEqual([]);
  });
  it("keeps same-brand cards and native ARS/USD facts independent", async()=>{
    const seed=syntheticSeed(); seed.cardIds.push("card-b");
    seed.accounts.push(...seed.accounts.filter(a=>a.id.startsWith("card-a:")).map(a=>({...a,id:a.id.replace("card-a:","card-b:")})));
    const port=createMemoryLedger(seed) as EvidenceLedgerPort,docs=createMemoryDocuments(),base=input();
    const json={...base.json,declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:100,usd:6.99}],transactions:[base.json.transactions[0],{...base.json.transactions[0],description:"SYNTHETIC USD SHOP",ars:null,usd:6.99}]};
    const a=await importStatement(port,docs,input({json}));
    const b=await importStatement(port,docs,input({key:"b",cardId:"card-b",json,pdf:Buffer.from("%PDF-card-b")}));
    expect(a.sourceRevisionId).not.toBe(b.sourceRevisionId);
    expect(a.purchaseIds).toHaveLength(2); expect(b.purchaseIds).toHaveLength(2);
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase").map(j=>j.currency).sort()).toEqual(["ARS","USD"]);
    await port.transaction(async tx=>{
      expect((await tx.currentStatementRevision("card-a"))?.id).toBe(a.sourceRevisionId);
      expect((await tx.currentStatementRevision("card-b"))?.id).toBe(b.sourceRevisionId);
    });
  });
  it("records explicit issuer dual-native repayments independently without a bank FX event",async()=>{
    const port=ledger(),base=input();
    const json={...base.json,declared_totals:[],transactions:[{...base.json.transactions[0],section:"payments",description:"SU PAGO EN PESOS TC 1200,00",ars:-100,usd:-6.99}]};
    const result=await importStatement(port,createMemoryDocuments(),input({json}));
    expect(result.reviews).toEqual([]);
    const journals=await port.journals("card-a");expect(journals.map(j=>j.currency).sort()).toEqual(["ARS","USD"]);expect(journals.every(j=>j.kind==="repayment")).toBe(true);
    expect(journals[0].evidenceIds).toEqual(journals[1].evidenceIds);
    expect(journals.every(j=>j.lines.some(l=>l.accountId===`clearing:${j.currency}:unresolved-source`))).toBe(true);
  });
  it("retains ambiguous dual-column values without inventing two acquisitions",async()=>{
    const port=ledger(),base=input();
    const result=await importStatement(port,createMemoryDocuments(),input({json:{...base.json,declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:100,usd:6.99}],transactions:[{...base.json.transactions[0],usd:6.99}]}}));
    expect(result.reviews.map(r=>r.code)).toContain("ambiguous_dual_currency_line");
    expect(await port.journals("card-a")).toEqual([]);
  });
  it("rejects missing source objects, tampered JSON, unknown cards and invalid amounts", async () => {
    const good=createMemoryDocuments();
    await expect(importStatement(ledger(),{...good,read:async()=>Buffer.from("corrupt")},input())).rejects.toThrow("document_hash_mismatch");
    await expect(importStatement(ledger(),good,input({rawJson:Buffer.from("{}\n")}))).rejects.toThrow("source_payload_conflict");
    await expect(importStatement(ledger(),good,input({cardId:"visa"}))).rejects.toThrow("unknown_card");
    expect(()=>statementMinor(1.005)).toThrow("invalid_source_amount");
    expect(()=>statementMinor(12.3400000001)).toThrow("invalid_source_amount");
    expect(statementMinor(6.99)).toBe(699);
  });
});

describe('Mercado Pago payment wording',()=>{
 it.each(['Pago del resumen','PAGO DE RESUMEN'])('recognizes %s as a card repayment',async description=>{
  const p=ledger(),base=input(),json={...base.json,declared_totals:[],transactions:[{...base.json.transactions[0],section:'payments',description,ars:-100,usd:null}]};
  const result=await importStatement(p,createMemoryDocuments(),input({json}));
  expect(result.reviews).toEqual([]);expect((await p.journals('card-a')).map(j=>j.kind)).toEqual(['repayment']);
 });
 it('does not turn a refund in the payments section into a repayment',async()=>{
  const p=ledger(),base=input(),json={...base.json,declared_totals:[],transactions:[{...base.json.transactions[0],section:'payments',description:'Reembolso de TUENTRADA COM',ars:-100,usd:null}]};
  const result=await importStatement(p,createMemoryDocuments(),input({json}));
  expect(result.reviews.map(r=>r.code)).toEqual(['unsupported_financial_nature']);expect(await p.journals('card-a')).toEqual([]);
 });
});
