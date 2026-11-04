import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { syntheticSeed, purchaseInput, billingInput, paymentInput, totals } from "./test-support";
import { recordPurchase, billInstallment, recordRepayment, recordLinkedCredit } from "./use-cases";
it("recognizes purchase once, billing moves debt and repayment preserves unbilled principal",async()=>{
 const p=createMemoryLedger(syntheticSeed());
 await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput());
 expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,billedMinor:10000,unbilledMinor:50000});
 await recordRepayment(p,paymentInput());expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,billedMinor:0,unbilledMinor:50000,clearingMinor:-10000});
});
it("six bills never create another expense, and overbilling remains reviewable",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());
 for(let n=1;n<=6;n++) await billInstallment(p,billingInput({key:`bill-${n}`,installment:n}));
 expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,billedMinor:60000,unbilledMinor:0});
 expect((await billInstallment(p,billingInput({key:"excess",installment:7,amountMinor:1}))).reviewCode).toBe("billing_exceeds_principal");
 expect((await billInstallment(p,billingInput({key:"changed-bill",amountMinor:9999}))).reviewCode).toBe("conflicting_installment");
});
it("retries purchase, bill and payment once and rejects a changed command",async()=>{
 const p=createMemoryLedger(syntheticSeed());for(let i=0;i<2;i++){await recordPurchase(p,purchaseInput({recordedAt:i?"2026-01-17T12:00:00Z":"2026-01-16T12:00:00Z"}));await billInstallment(p,billingInput());await recordRepayment(p,paymentInput());}
 expect(await p.journals("card-a")).toHaveLength(3);
 await expect(recordPurchase(p,purchaseInput({principalMinor:50000,allocations:[{accountId:"expense:unallocated",purposeId:"unallocated",minor:50000}]}))).rejects.toThrow("command_conflict");
});
it("overpayment becomes card credit and never silently repays unbilled principal",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput());await recordRepayment(p,paymentInput({amountMinor:15000}));
 expect(await totals(p,"card-a","ARS")).toMatchObject({billedMinor:-5000,unbilledMinor:50000,clearingMinor:-15000});
 const components=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));expect(components.every(c=>c.outstandingMinor===0)).toBe(true);
});
it("preserves USD independently and rejects unsafe input",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await recordPurchase(p,purchaseInput({key:"usd",purchaseId:"usd",currency:"USD"}));
 expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,unbilledMinor:60000});expect(await totals(p,"card-a","USD")).toMatchObject({expenseMinor:60000,unbilledMinor:60000});
 await expect(recordRepayment(p,paymentInput({amountMinor:Number.MAX_SAFE_INTEGER+1}))).rejects.toThrow("invalid_minor_units");
 await expect(recordPurchase(p,purchaseInput({principalMinor:.5}))).rejects.toThrow("invalid_minor_units");
});
it("repays oldest billed purposes and explicit issuer evidence overrides that convention",async()=>{
 const p=createMemoryLedger(syntheticSeed());
 await recordPurchase(p,purchaseInput({principalMinor:30000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000},{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));
 await billInstallment(p,billingInput({amountMinor:30000}));
 const before=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));
 await recordRepayment(p,paymentInput({amountMinor:15000}));
 expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a"))).map(c=>c.outstandingMinor)).toEqual([0,15000]);
 const other=createMemoryLedger(syntheticSeed());await recordPurchase(other,purchaseInput({principalMinor:30000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000},{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));await billInstallment(other,billingInput({amountMinor:30000}));const otherComponents=await other.transaction(tx=>tx.billedComponents("ARS","card-a"));
 await recordRepayment(other,paymentInput({amountMinor:15000,issuerAllocations:[{componentId:otherComponents[1].id,minor:15000}]}));
 expect((await other.transaction(tx=>tx.billedComponents("ARS","card-a"))).map(c=>c.outstandingMinor)).toEqual([10000,5000]);expect(before).toHaveLength(2);
});

it("linked credits reverse original allocation in their evidenced period and constrain schedule effects",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput());
 const credit={key:"credit-1",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS" as const,amountMinor:15000,billedReductionMinor:5000,unbilledReductionMinor:10000,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]};
 await recordLinkedCredit(p,credit);expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:45000,billedMinor:5000,unbilledMinor:40000});
 expect((await p.journals("card-a")).find(j=>j.kind==="credit")?.effectiveDate).toBe("2026-04-01");expect((await recordLinkedCredit(p,credit)).status).toBe("duplicate");
 expect((await recordLinkedCredit(p,{...credit,key:"bad-credit",amountMinor:60000,billedReductionMinor:60000,unbilledReductionMinor:0})).reviewCode).toBe("unsupported_credit_schedule");
 await expect(recordLinkedCredit(p,{...credit,key:"wrong-split",billedReductionMinor:1})).rejects.toThrow("invalid_credit_split");
});
it("does not allocate an earlier payment to a future billing",async()=>{const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput({effectiveDate:"2026-03-01"}));await recordRepayment(p,paymentInput());expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(10000);});
it("retains unsupported financial classification as review without a posting",async()=>{const p=createMemoryLedger(syntheticSeed());const result=await recordPurchase(p,purchaseInput({allocations:[{accountId:"equity:opening",purposeId:"unknown",minor:60000}]}));expect(result.reviewCode).toBe("unsupported_financial_nature");expect(await p.journals("card-a")).toEqual([]);});
it("transaction-scoped purchase rolls back together with its outer command",async()=>{
 const {recordPurchaseTx}=await import("./use-cases");const p=createMemoryLedger(syntheticSeed());
 await expect(p.transaction(async tx=>{await recordPurchaseTx(tx,purchaseInput());throw new Error("outer_source_failure");})).rejects.toThrow("outer_source_failure");
 expect(await p.journals("card-a")).toEqual([]);expect(await p.transaction(tx=>tx.purchase("purchase-a"))).toBeNull();
 expect((await recordPurchase(p,purchaseInput())).status).toBe("posted");
});
it("replays an earlier repayment imported after a future repayment without rewriting either journal",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput({amountMinor:30000}));
 await recordRepayment(p,paymentInput({key:"future",amountMinor:15000,effectiveDate:"2026-03-10"}));await recordRepayment(p,paymentInput({key:"earlier",amountMinor:20000,effectiveDate:"2026-02-10"}));
 const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));const future=state.payments.find(p=>p.key==="future")!;
 expect(state.attributionRevisions.filter(a=>a.paymentId===future.id).map(a=>a.unappliedMinor)).toEqual([0,5000]);
 expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(0);expect((await p.journals("card-a")).filter(j=>j.kind==="repayment")).toHaveLength(2);
 expect(await totals(p,"card-a","ARS")).toMatchObject({billedMinor:-5000,unbilledMinor:30000});
});
it("allocates a historical repayment when its earlier billing arrives later",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await recordRepayment(p,paymentInput());
 let state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));expect(state.attributionRevisions.map(a=>a.unappliedMinor)).toEqual([10000]);
 await billInstallment(p,billingInput());state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));expect(state.attributionRevisions.map(a=>a.unappliedMinor)).toEqual([10000,0]);expect(state.attributions[0]).toMatchObject({revision:2,minor:10000});
 expect((await p.journals("card-a")).filter(j=>j.kind==="repayment")).toHaveLength(1);
});
it("replays a later refund around backdated payments and retains attribution history",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput());await billInstallment(p,billingInput({amountMinor:30000}));
 await recordLinkedCredit(p,{key:"refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:5000,billedReductionMinor:5000,unbilledReductionMinor:0,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
 await recordRepayment(p,paymentInput({key:"future",amountMinor:15000,effectiveDate:"2026-05-01"}));await recordRepayment(p,paymentInput({key:"backdated",amountMinor:15000,effectiveDate:"2026-03-01"}));
 const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));const future=state.payments.find(p=>p.key==="future")!;expect(state.attributionRevisions.filter(a=>a.paymentId===future.id).map(a=>a.unappliedMinor)).toEqual([0,5000]);
 expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(0);expect(await totals(p,"card-a","ARS")).toMatchObject({billedMinor:-5000,unbilledMinor:30000});
});
it("preserves explicit issuer associations when an earlier conventional payment arrives",async()=>{
 const p=createMemoryLedger(syntheticSeed());await recordPurchase(p,purchaseInput({principalMinor:30000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000},{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));await billInstallment(p,billingInput({amountMinor:30000}));
 const components=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));await recordRepayment(p,paymentInput({key:"issuer",amountMinor:15000,effectiveDate:"2026-03-01",issuerAllocations:[{componentId:components[1].id,minor:15000}]}));
 await recordRepayment(p,paymentInput({key:"earlier",amountMinor:15000,effectiveDate:"2026-02-10"}));const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));const issuer=state.payments.find(p=>p.key==="issuer")!;
 expect(issuer.issuerAllocations).toEqual([{componentId:components[1].id,minor:15000}]);expect(state.attributions.filter(a=>a.paymentId===issuer.id).every(a=>a.method==="issuer"&&a.componentId===components[1].id&&a.minor===15000)).toBe(true);
 expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))).toMatchObject([{outstandingMinor:0},{outstandingMinor:0}]);
});
