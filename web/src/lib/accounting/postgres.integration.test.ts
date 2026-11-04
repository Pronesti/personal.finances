import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import {seedActualCatalogCards,saveAccountName,saveGroup} from "./catalog-service";
import {createMemoryDocuments} from "./documents";
import {receiptExtraction} from "./receipt-test-support";
import {importReceipt} from "./receipt-import";
import {matchReceiptProductsTx,createProductTx,applyReview,reviewReceiptItem,type MatchSubject,type CodeSubject} from "./review";
import { AccountingError } from "./model";
import { balancedJournal, withTestLedger, purchaseInput, billingInput, paymentInput, totals } from "./test-support";
import { postJournal, recordPurchase, billInstallment, recordRepayment, recordLinkedCredit, correctPurchase } from "./use-cases";
const enabled=process.env.ACCOUNTING_PG_TESTS==="1";
if(enabled && !process.env.ACCOUNTING_TEST_DATABASE_URL) throw new Error("missing_ACCOUNTING_TEST_DATABASE_URL");
describe.skipIf(!enabled)("PostgreSQL ledger",()=>{
 it("persists actual card/chart identities, custom labels and overlapping cross-type groups",async()=>withTestLedger(async p=>{
  await seedActualCatalogCards(p,[{id:"actual-card",displayName:"Actual card"}]);await saveAccountName(p,{key:"name",accountId:"expense:home:cleaning",customName:"Mi casa",recordedAt:"2026-03-01T00:00:00Z"});await seedActualCatalogCards(p,[{id:"actual-card",displayName:"Actual card"}]);expect((await p.transaction(tx=>tx.account("expense:home:cleaning")))?.customName).toBe("Mi casa");
  await saveGroup(p,{key:"group",id:"custom",customName:"Shared",labelKey:null,accountIds:["asset","expense:home:cleaning"],additive:false,recordedAt:"2026-03-01T00:00:00Z"});expect((await p.transaction(tx=>tx.catalogGroups())).find(g=>g.id==="custom")?.accountIds).toHaveLength(2);
 },{seed:false}));
 it("persists numeric products, per-item identity reviews, code remapping and immutable source evidence",async()=>withTestLedger(async p=>{
  const imported=await importReceipt(p,createMemoryDocuments(),{key:"products",bytes:Buffer.from("%PDF-review-integration"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"});await p.transaction(tx=>matchReceiptProductsTx(tx,imported.sourceRevisionId));const line=(await p.transaction(tx=>tx.sourceLines(imported.sourceRevisionId)))[0],raw=structuredClone(line.payload),match=await p.transaction(tx=>tx.reviewSubject("match",line.id)) as MatchSubject;
  expect(Number.isSafeInteger(Number(match.productId))).toBe(true);await applyReview(p,{key:"review-product",subjectId:match.productId,kind:"product_update",payload:{name:"Known milk",category:"dairy",unit:"un"},recordedAt:"2026-03-01T00:00:00Z"});await reviewReceiptItem(p,{key:"review-item",receiptRevisionId:imported.sourceRevisionId,sourceLineId:line.id,productId:match.productId,recordedAt:"2026-03-01T00:00:00Z"});expect((await p.transaction(tx=>tx.reviewEvents(line.id))).at(-1)?.state).toBe("reviewed");
  const target=await p.transaction(tx=>createProductTx(tx,{name:"Other",category:"other",unit:"un",reviewed:true}));const code=(await p.transaction(tx=>tx.reviewSubjects("code")))[0] as CodeSubject;await applyReview(p,{key:"move",subjectId:code.id,kind:"move_code",payload:{targetId:target},recordedAt:"2026-03-02T00:00:00Z"});expect((await p.transaction(tx=>tx.reviewSubject("match",line.id))) as MatchSubject).toMatchObject({productId:target,reviewed:false});expect((await p.transaction(tx=>tx.reviewEvents(line.id))).at(-1)?.state).toBe("open");expect((await p.transaction(tx=>tx.sourceLines(imported.sourceRevisionId)))[0].payload).toEqual(raw);
 }));

 it("replays out-of-order repayments and billing in one transaction history",async()=>withTestLedger(async p=>{
  await recordPurchase(p,purchaseInput());await recordRepayment(p,paymentInput({key:"future",amountMinor:15000,effectiveDate:"2026-03-10"}));
  await billInstallment(p,billingInput({amountMinor:30000}));await recordRepayment(p,paymentInput({key:"earlier",amountMinor:20000,effectiveDate:"2026-02-10"}));
  const state=await p.transaction(tx=>tx.attributionState("card-a","ARS")),future=state.payments.find(p=>p.key==="future")!;
  expect(state.attributionRevisions.filter(a=>a.paymentId===future.id).sort((a,b)=>a.revision-b.revision).map(a=>a.unappliedMinor)).toEqual([15000,0,5000]);
  expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(0);expect((await p.journals("card-a")).filter(j=>j.kind==="repayment")).toHaveLength(2);expect(await totals(p,"card-a","ARS")).toMatchObject({billedMinor:-5000,unbilledMinor:30000});
 }));
 it("replays backdated repayment around a later refund with preserved revisions",async()=>withTestLedger(async p=>{
  await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput({amountMinor:30000}));
  await recordLinkedCredit(p,{key:"refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:5000,billedReductionMinor:5000,unbilledReductionMinor:0,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
  await recordRepayment(p,paymentInput({key:"future",amountMinor:15000,effectiveDate:"2026-05-01"}));await recordRepayment(p,paymentInput({key:"earlier",amountMinor:15000,effectiveDate:"2026-03-01"}));
  const state=await p.transaction(tx=>tx.attributionState("card-a","ARS")),future=state.payments.find(p=>p.key==="future")!;
  expect(state.attributionRevisions.filter(a=>a.paymentId===future.id).sort((a,b)=>a.revision-b.revision).map(a=>a.unappliedMinor)).toEqual([0,5000]);expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(0);
  expect((await p.journals("card-a")).filter(j=>j.kind==="credit")).toHaveLength(1);
 }));

 it("corrects original-period classification and linked credits without rewriting payment history",async()=>withTestLedger(async p=>{
  const original=purchaseInput();await recordPurchase(p,original);await billInstallment(p,billingInput());await recordRepayment(p,paymentInput({amountMinor:5000}));
  await recordLinkedCredit(p,{key:"refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:12000,billedReductionMinor:2000,unbilledReductionMinor:10000,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
  const before=await totals(p,"card-a","ARS");await correctPurchase(p,{key:"fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:30000},{accountId:"expense:travel",purposeId:"travel",minor:30000}]},recordedAt:"2026-05-01T12:00:00Z",reason:"receipt reclassification"});
  expect(await totals(p,"card-a","ARS")).toEqual(before);expect((await p.transaction(tx=>tx.linkedCredits("purchase-a")))).toHaveLength(1);
  const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));expect(state.attributions.some(a=>a.revision===1&&a.purposeId==="unallocated")).toBe(true);expect(state.attributions.some(a=>a.revision===2&&a.purposeId==="food")).toBe(true);
  const journals=await p.journals("card-a");expect(journals.find(j=>j.kind==="reversal"&&j.effectiveDate==="2026-01-15")?.recordedAt).toBe("2026-05-01T12:00:00.000Z");expect(journals.find(j=>j.kind==="replacement"&&j.effectiveDate==="2026-04-01")).toBeDefined();expect(journals.filter(j=>j.kind==="repayment")).toHaveLength(1);
 }));
 it("persists purchase once, six bills, repayments, credits and independent USD",async()=>withTestLedger(async p=>{
  const purchase=purchaseInput();await recordPurchase(p,purchase);await recordPurchase(p,{...purchase,recordedAt:"2026-01-20T00:00:00Z"});
  await billInstallment(p,billingInput());await billInstallment(p,billingInput());
  await recordRepayment(p,paymentInput({amountMinor:15000}));await recordRepayment(p,paymentInput({amountMinor:15000}));
  expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,billedMinor:-5000,unbilledMinor:50000,clearingMinor:-15000});
  for(let n=2;n<=6;n++) await billInstallment(p,billingInput({key:`bill-${n}`,installment:n}));
  expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,billedMinor:45000,unbilledMinor:0});
  expect((await billInstallment(p,billingInput({key:"over",installment:7}))).reviewCode).toBe("billing_exceeds_principal");
  await recordPurchase(p,purchaseInput({key:"usd-purchase",purchaseId:"usd-purchase",currency:"USD"}));
  expect(await totals(p,"card-a","USD")).toMatchObject({expenseMinor:60000,unbilledMinor:60000});
  await recordLinkedCredit(p,{key:"refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:5000,billedReductionMinor:5000,unbilledReductionMinor:0,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T00:00:00Z",evidenceIds:["synthetic:e1"]});
  expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:55000,billedMinor:40000,unbilledMinor:0});
 }));
 it("honors issuer attribution and keeps opening debt unattributed",async()=>withTestLedger(async p=>{
  await recordPurchase(p,purchaseInput({principalMinor:30000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000},{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));
  await billInstallment(p,billingInput({amountMinor:30000}));const components=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));
  await recordRepayment(p,paymentInput({amountMinor:15000,issuerAllocations:[{componentId:components[1].id,minor:15000}]}));
  expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a"))).map(c=>c.outstandingMinor)).toEqual([10000,5000]);
  const opening=balancedJournal({id:"opening",commandKey:"opening",kind:"opening",lines:[{accountId:"equity:opening",debitMinor:10000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:"card-a:ARS:billed",debitMinor:0,creditMinor:10000,purchaseId:null,purposeId:null}]});
  await postJournal(p,opening,"opening");await p.transaction(tx=>tx.appendBilling({id:"opening",purchaseId:null,cardId:"card-a",currency:"ARS",installment:1,amountMinor:10000,effectiveDate:"2026-01-01",purchaseDate:"2026-01-01",journalId:"opening",components:[{id:"opening-component",purposeId:null,minor:10000}]}));
  await recordRepayment(p,paymentInput({key:"opening-payment",amountMinor:10000}));
  const after=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));expect(after.find(c=>c.id==="opening-component")).toMatchObject({purposeId:null,outstandingMinor:0});
  await expect(recordRepayment(p,paymentInput({key:"unsafe",amountMinor:Number.MAX_SAFE_INTEGER+1}))).rejects.toThrow("invalid_minor_units");
 }));
 it("persists FIFO purpose balances and validates issuer allocation",async()=>withTestLedger(async p=>{
  await recordPurchase(p,purchaseInput({principalMinor:30000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000},{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));
  await billInstallment(p,billingInput({amountMinor:30000}));await recordRepayment(p,paymentInput({amountMinor:15000}));
  const components=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));expect(components.map(c=>c.outstandingMinor)).toEqual([0,15000]);
  await expect(recordRepayment(p,paymentInput({key:"invalid-allocation",issuerAllocations:[{componentId:components[0].id,minor:10001}]}))).rejects.toThrow("invalid_issuer_allocation");
 }));
  it("serializes equal retries and rejects changed content",async()=>withTestLedger(async p=>{
    const results=await Promise.all([postJournal(p,balancedJournal(),"d"),postJournal(p,balancedJournal({id:"retry"}),"d")]);
    expect(results.map(r=>r.status).sort()).toEqual(["duplicate","posted"]);expect(await p.journals("card-a")).toHaveLength(1);
    await expect(postJournal(p,balancedJournal(),"changed")).rejects.toThrow("command_conflict");
  }));
  it("rolls back a finalized journal when later work fails",async()=>withTestLedger(async p=>{
    await expect(p.transaction(async tx=>{await tx.appendJournal(balancedJournal());throw new AccountingError("forced_after_lines");})).rejects.toThrow("forced_after_lines");
    expect(await p.journals("card-a")).toEqual([]);expect(await p.transaction(tx=>tx.command("synthetic:purchase-1"))).toBeNull();
  }));
  it("rejects cross-currency accounts and raw mutation/finalization",async()=>withTestLedger(async(p,{connectionString,schema})=>{
    await expect(postJournal(p,balancedJournal({currency:"USD"}),"usd")).rejects.toThrow("account_currency_mismatch");
    await postJournal(p,balancedJournal(),"d");const pool=new Pool({connectionString,connectionTimeoutMillis:5000});const c=await pool.connect();
    try {
      await c.query(`SET search_path TO "${schema}",pg_catalog`);
      await expect(c.query("UPDATE journal_lines SET debit_minor=1 WHERE journal_id='synthetic:j1' AND ordinal=0")).rejects.toThrow("immutable_posted_journal");
      await expect(c.query("DELETE FROM journals WHERE id='synthetic:j1'")).rejects.toThrow("immutable_posted_journal");
      await c.query("INSERT INTO journals(id,command_key,card_id,currency,effective_date,recorded_at,kind) VALUES('bad','bad','card-a','ARS','2026-01-15',now(),'purchase')");
      await c.query("INSERT INTO journal_lines VALUES('bad',0,'expense:unallocated',100,0,null,null),('bad',1,'card-a:ARS:unbilled',0,99,null,null)");
      await c.query("INSERT INTO journal_evidence VALUES('bad','synthetic:e1')");
      await expect(c.query("UPDATE journals SET status='posted' WHERE id='bad'")).rejects.toThrow("unbalanced_journal");
      expect(await p.journals("card-a")).toHaveLength(1);
    } finally {c.release();await pool.end();}
  }));
});
