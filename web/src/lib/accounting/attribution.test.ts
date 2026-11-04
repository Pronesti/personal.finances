import { expect, it } from "vitest";
import { allocateOldestBilled, outstandingComponents } from "./attribution";
it("allocates only billed components in date and identity order",()=>{expect(allocateOldestBilled(15000,[{id:"food",purchaseId:"p1",purposeId:"food",currency:"ARS",billedDate:"2026-01-01",purchaseDate:"2026-01-01",outstandingMinor:10000},{id:"travel",purchaseId:"p2",purposeId:"travel",currency:"ARS",billedDate:"2026-02-01",purchaseDate:"2026-01-01",outstandingMinor:20000}])).toEqual({assigned:[{componentId:"food",purposeId:"food",minor:10000},{componentId:"travel",purposeId:"travel",minor:5000}],unappliedMinor:0});});
it("retains null purpose for opening debt and exposes unapplied card credit",()=>{
 expect(allocateOldestBilled(15000,[{id:"opening",purchaseId:null,purposeId:null,currency:"ARS",billedDate:"2026-01-01",purchaseDate:"2026-01-01",outstandingMinor:10000}])).toEqual({assigned:[{componentId:"opening",purposeId:null,minor:10000}],unappliedMinor:5000});
});
it("breaks ties by stable component identity and rejects unsafe inputs",()=>{
 const c={purchaseId:null,purposeId:null,currency:"ARS" as const,billedDate:"2026-01-01",purchaseDate:"2026-01-01",outstandingMinor:100};
 expect(allocateOldestBilled(100,[{...c,id:"b"},{...c,id:"a"}]).assigned[0].componentId).toBe("a");expect(()=>allocateOldestBilled(.5,[])).toThrow("invalid_minor_units");
});

it("an empty later attribution revision does not resurrect older allocations",()=>{
 const bills=[{id:"b",purchaseId:"p",cardId:"card-a",currency:"ARS" as const,installment:1,amountMinor:100,effectiveDate:"2026-01-01",purchaseDate:"2026-01-01",journalId:"j",components:[{id:"c",purposeId:"food",minor:100}]}];
 const attrs=[{id:"a",paymentId:"payment",componentId:"c",purposeId:"food",minor:100,method:"oldest_billed_first" as const,revision:1}];
 expect(outstandingComponents(bills,attrs,[],[],[{paymentId:"payment",revision:2,unappliedMinor:100},{paymentId:"payment",revision:1,unappliedMinor:0}])[0].outstandingMinor).toBe(100);
});
