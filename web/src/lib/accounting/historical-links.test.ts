import {expect,it} from "vitest";
import {createMemoryLedger} from "./memory";
import {recordPurchase} from "./use-cases";
import {purchaseInput} from "./test-support";
import {syntheticSeed} from "./test-support";
import {historicalLinkFixture} from "./historical-links-test-support";
import {recordHistoricalAssociation,currentHistoricalAssociations} from "./historical-links";
it("retains source-only matching, original provenance and complete link/unlink history without journals",async()=>{
 const port=createMemoryLedger(syntheticSeed()),{input}=await historicalLinkFixture(port);
 expect(await port.journals("card-a")).toEqual([]);
 const linked=await recordHistoricalAssociation(port,input);expect(linked).toMatchObject({receiptMinor:8000,statementMinor:4000,installmentCount:2,method:"auto",recordedAt:input.recordedAt,provenance:input.provenance});
 expect(await recordHistoricalAssociation(port,{...input,recordedAt:"2026-02-01T12:00:00Z"})).toEqual(linked);
 const unlink=await recordHistoricalAssociation(port,{...input,key:"unlink",sourceLineId:null,action:"unlink",method:"manual",expectedPreviousDecisionId:linked.id});
 expect(unlink.sourceLineId).toBe(linked.sourceLineId);expect(unlink.previousDecisionId).toBe(linked.id);
 expect(currentHistoricalAssociations(await port.transaction(tx=>tx.historicalAssociations()))).toEqual([]);
 const relink=await recordHistoricalAssociation(port,{...input,key:"relink",expectedPreviousDecisionId:unlink.id});
 expect(currentHistoricalAssociations(await port.transaction(tx=>tx.historicalAssociations()))).toEqual([relink]);
 expect(await port.journals("card-a")).toEqual([]);
});
it("rejects stale chains, command conflicts, duplicate charge ownership and missing source evidence atomically",async()=>{
 const port=createMemoryLedger(syntheticSeed()),{input,receipts}=await historicalLinkFixture(port);const first=await recordHistoricalAssociation(port,input);
 await expect(recordHistoricalAssociation(port,{...input,key:"stale"})).rejects.toThrow("stale_historical_association");
 await expect(recordHistoricalAssociation(port,{...input,action:"unlink"})).rejects.toThrow("command_conflict");
 await expect(recordHistoricalAssociation(port,{...input,key:"other-receipt",receiptRevisionId:receipts[1].sourceRevisionId})).rejects.toThrow("source_charge_already_linked");
 await expect(recordHistoricalAssociation(port,{...input,key:"missing",receiptRevisionId:receipts[1].sourceRevisionId,sourceLineId:"missing"})).rejects.toThrow("historical_association_source_unavailable");
 expect(await port.transaction(tx=>tx.historicalAssociations())).toEqual([first]);expect(await port.journals("card-a")).toEqual([]);
});
it("does not associate incorrect native amounts, mixed USD or later installment observations",async()=>{
 for(const overrides of [{ars:39.98},{usd:1},{installment_number:2}]){const port=createMemoryLedger(syntheticSeed()),{input}=await historicalLinkFixture(port,overrides);await expect(recordHistoricalAssociation(port,input)).rejects.toThrow();expect(await port.transaction(tx=>tx.historicalAssociations())).toHaveLength(0);}
});

it("cannot overlay a conflicting financial receipt association",async()=>{
 const port=createMemoryLedger(syntheticSeed()),{input}=await historicalLinkFixture(port);
 await recordPurchase(port,purchaseInput());
 await port.transaction(async tx=>{const previous=(await tx.receiptLinkDecisions(input.receiptRevisionId)).at(-1);await tx.appendReceiptLinkDecision({id:"financial-link",key:"financial-link",receiptRevisionId:input.receiptRevisionId,purchaseId:"purchase-a",cardId:"card-a",action:"link",previousDecisionId:previous?.id??null,recordedAt:input.recordedAt,paymentVerified:true,allocation:null,itemAllocations:[]});});
 const before=await port.journals("card-a");await expect(recordHistoricalAssociation(port,input)).rejects.toThrow("receipt_has_financial_link");expect(await port.transaction(tx=>tx.historicalAssociations())).toEqual([]);expect(await port.journals("card-a")).toEqual(before);
});
