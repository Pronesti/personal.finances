import { expect,it } from "vitest";
import { createMemoryLedger } from "./memory";
import { syntheticSeed,purchaseInput,billingInput,paymentInput,totals } from "./test-support";
import { recordPurchase,billInstallment,recordRepayment,correctPurchase } from "./use-cases";
it("corrects January in January and retains actual March recording time",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);
 await correctPurchase(p,{key:"fix-1",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"reviewed evidence"});
 const journals=await p.journals("card-a");expect(journals.find(j=>j.kind==="reversal")).toMatchObject({effectiveDate:"2026-01-15",recordedAt:"2026-03-01T12:00:00Z"});expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);expect(await totals(p,"card-a","ARS")).toMatchObject({expenseMinor:60000,unbilledMinor:60000});
});
it("retains prior payment attribution and adds corrected purpose revision",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);await billInstallment(p,billingInput());await recordRepayment(p,paymentInput({amountMinor:5000}));
 await correctPurchase(p,{key:"fix-purpose",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"receipt allocation"});
 const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));expect(state.attributions.map(a=>[a.revision,a.purposeId,a.minor])).toEqual([[1,"unallocated",5000],[2,"food",5000]]);
 expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0]).toMatchObject({purposeId:"food",outstandingMinor:5000});
 expect((await p.journals("card-a")).filter(j=>j.kind==="repayment")).toHaveLength(1);
});
it("reviews changed principal after billing or repayment without partial posting",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);await billInstallment(p,billingInput());await recordRepayment(p,paymentInput());
 const result=await correctPurchase(p,{key:"fix-amount",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,principalMinor:70000,allocations:[{accountId:"expense:food",purposeId:"food",minor:70000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"uncertain schedule"});
 expect(result.reviewCode).toBe("correction_requires_schedule_revalidation");expect(await p.journals("card-a")).toHaveLength(3);expect((await p.transaction(tx=>tx.purchase("purchase-a")))?.version).toBe(1);
});
it("serializes simultaneous corrections and rejects the stale expected version",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);
 const input={key:"fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"receipt"};
 const results=await Promise.allSettled([correctPurchase(p,input),correctPurchase(p,{...input,key:"other-fix"})]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")[0]).toMatchObject({reason:{code:"stale_purchase_version"}});
 expect((await correctPurchase(p,input)).status).toBe("duplicate");
});
it("reclassifies linked refund history in its own April period without crediting principal twice",async()=>{
 const {recordLinkedCredit}=await import("./use-cases");const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);await billInstallment(p,billingInput());await recordRepayment(p,paymentInput({amountMinor:5000}));
 await recordLinkedCredit(p,{key:"refund",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:12000,billedReductionMinor:2000,unbilledReductionMinor:10000,effectiveDate:"2026-04-01",recordedAt:"2026-04-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
 const before=await totals(p,"card-a","ARS");await correctPurchase(p,{key:"fix-with-refund",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-05-01T12:00:00Z",reason:"correct original classification"});
 expect(await totals(p,"card-a","ARS")).toEqual(before);const journals=await p.journals("card-a");expect(journals.filter(j=>j.kind==="credit")).toHaveLength(1);
 const refundReplacement=journals.find(j=>j.kind==="replacement"&&j.effectiveDate==="2026-04-01");expect(refundReplacement).toMatchObject({recordedAt:"2026-05-01T12:00:00Z",evidenceIds:["synthetic:e1"]});expect(refundReplacement?.lines.find(l=>l.accountId==="expense:food")?.creditMinor).toBe(12000);
 expect((await p.transaction(tx=>tx.linkedCredits("purchase-a")))).toHaveLength(1);expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0]).toMatchObject({purposeId:"food",outstandingMinor:3000});
});
it("preserves exact totals when a correction splits a previously single purpose",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput();await recordPurchase(p,original);await billInstallment(p,billingInput());await recordRepayment(p,paymentInput({amountMinor:5000}));
 await correctPurchase(p,{key:"split",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:30000},{accountId:"expense:travel",purposeId:"travel",minor:30000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"split receipt"});
 const components=await p.transaction(tx=>tx.billedComponents("ARS","card-a"));expect(components.map(c=>[c.purposeId,c.outstandingMinor])).toEqual([["food",0],["travel",5000]]);
});
it("preserves future issuer evidence while correcting a chain containing a backdated conventional payment",async()=>{
 const p=createMemoryLedger(syntheticSeed()),original=purchaseInput({principalMinor:20000,allocations:[{accountId:"expense:unallocated",purposeId:"unallocated",minor:20000}]});await recordPurchase(p,original);await billInstallment(p,billingInput({amountMinor:20000}));
 const component=(await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0];await recordRepayment(p,paymentInput({key:"issuer",amountMinor:15000,effectiveDate:"2026-03-01",issuerAllocations:[{componentId:component.id,minor:15000}]}));await recordRepayment(p,paymentInput({key:"early",amountMinor:10000,effectiveDate:"2026-02-10"}));
 const result=await correctPurchase(p,{key:"fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:20000}]},recordedAt:"2026-04-01T12:00:00Z",reason:"receipt"});expect(result.status).toBe("posted");
 const state=await p.transaction(tx=>tx.attributionState("card-a","ARS"));const issuer=state.payments.find(p=>p.key==="issuer")!;expect(state.attributions.filter(a=>a.paymentId===issuer.id&&a.revision===2)).toMatchObject([{purposeId:"food",minor:15000,method:"issuer"}]);expect((await p.transaction(tx=>tx.billedComponents("ARS","card-a")))[0].outstandingMinor).toBe(0);
});
