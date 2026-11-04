import {expect,it} from "vitest";
import {retainedEconomicParity} from "./reconstruction-economic-parity";
import type {ReportFact} from "./read-model";
import type {HistoricalReceiptAssociation} from "./historical-links";
function fixture() {
 const rows=[{table:"transactions",id:"[1]",payload:{id:1,section:"purchases",description:"SHOP",date:"2026-01-15",ars:10,usd:null,installment_count:null,installment_number:null}},{table:"transactions",id:"[2]",payload:{id:2,section:"purchases",description:"COTO",date:"2026-01-16",ars:20,usd:null,installment_count:2,installment_number:1,fingerprint:"fp2"}},{table:"receipts",id:"[7]",payload:{id:7,total_cents:4000,date:"2026-01-16"}},{table:"receipt_charge_links",id:"[7]",payload:{receipt_id:7,fingerprint:"fp2"}}];
 const base={purchaseId:null,cardId:"card-a",origin:"historical_acquisition" as const,kind:"purchase" as const,merchant:"COTO",accountId:"expense:unallocated",purposeId:"unallocated",currency:"ARS" as const,effectiveDate:"2026-01-15",cycleMonth:"2026-01",coverage:"complete" as const};
 const facts:ReportFact[]=[{...base,id:"p1",sourceLineId:"l1",statementId:"s1",minor:1000},{...base,id:"p2",sourceLineId:"l2",statementId:"s1",minor:4000,effectiveDate:"2026-01-16",receiptIds:[12]},{...base,id:"b2",sourceLineId:"l2",statementId:"s1",minor:2000,effectiveDate:"2026-01-16",kind:"billing",origin:"issuer_observation",receiptIds:[12]}];
 const association:HistoricalReceiptAssociation={id:"link",key:"link",digest:"a".repeat(64),receiptRevisionId:"r1",sourceLineId:"l2",cardId:"card-a",currency:"ARS",receiptMinor:4000,statementMinor:2000,installmentCount:2,action:"link",previousDecisionId:null,method:"auto",recordedAt:"2026-01-17T12:00:00Z",legacyFingerprint:"fp2",provenance:{}};
 return {rows,facts,sourceLines:new Map([["[1]","l1"],["[2]","l2"]]),receiptIds:new Map([["[7]",12]]),receiptRevisions:new Map([["[7]","r1"]]),associations:[association]};
}
it("compares known oneoff and full receipt acquisitions separately from their billed observations",()=>{
 const proof=retainedEconomicParity(fixture());expect(proof.acquisitions.before.values).toEqual({"known-acquisition/2026-01/ARS":5000});expect(proof.acquisitions.result.unexplained).toEqual([]);expect(proof.acquisitions.actualFactCount).toBe(2);expect(proof.associations.result.unexplained).toEqual([]);expect(proof.associations.currentCount).toBe(1);
});
it("does not excuse missing receipt economic recognition using preserved billed spending",()=>{
 const f=fixture();f.facts=f.facts.filter(row=>row.id!=="p2");const proof=retainedEconomicParity(f);expect(proof.acquisitions.result.unexplained).not.toEqual([]);expect(proof.associations.result.unexplained).toEqual([]);
});
it("fails duplicate recognition and a mismatched canonical receipt association",()=>{
 const f=fixture();f.facts.push({...f.facts[1],id:"duplicate"});expect(retainedEconomicParity(f).acquisitions.result.unexplained).not.toEqual([]);
 const g=fixture();g.associations[0].receiptRevisionId="different-receipt";expect(retainedEconomicParity(g).associations.result.unexplained).not.toEqual([]);
});
