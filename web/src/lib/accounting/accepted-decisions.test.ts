import { expect, it } from "vitest";
import type { StatementJson } from "../integrity";
import { baseCatalog, cardAccounts } from "./catalog";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./documents";
import { importStatement } from "./statement-import";
import { classifyPurchase } from "./review";
const recordedAt="2026-08-01T12:00:00Z";
const ledger=()=>createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Synthetic card")],cardIds:["card-a"]});
function line(description:string,ars:number|null,usd:number|null,section="purchases"):StatementJson["transactions"][number]{return {section,block:1,date:"2026-07-10",description,ars,usd,installment_number:null,installment_count:null};}
async function admit(port:ReturnType<typeof ledger>,transactions:StatementJson["transactions"],withRate=false){
 const json:StatementJson={file:"synthetic-decisions.pdf",brand:"visa",period:{closing_date:"2026-07-30"},transactions,...(withRate?{rates:{annual_nominal_ars:60,monthly_effective_ars:5}}:{})};
 return importStatement(port,createMemoryDocuments(),{key:"accepted-decisions",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic-accepted-decisions"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt,appRevision:"accepted-decisions-test"});
}
const classify=(port:ReturnType<typeof ledger>,purchaseId:string,accountId:string,purposeId:string,key:string)=>classifyPurchase(port,{key,cardId:"card-a",purchaseId,accountId,purposeId,scope:"selected",match:null,recordedAt});
it("T01 Q17/Q21 uses explicit abroad review rather than USD or merchant nationality as Travel evidence",async()=>{
 const port=ledger(),result=await admit(port,[line("SYNTHETIC RESTAURANT",null,30),line("SYNTHETIC ONLINE SUBSCRIPTION",null,10),line("SYNTHETIC FOREIGN PROCESSOR",100,null)]);
 expect(result.reviews).toEqual([]);const [meal,subscription,uncertain]=result.purchaseIds;
 await port.transaction(async tx=>{for(const id of result.purchaseIds)expect((await tx.purchase(id))?.allocations[0].accountId).toBe("expense:unallocated");});
 // Operator review supplies the physical-abroad decision. No inferred source field is invented.
 await classify(port,meal,"expense:travel:abroad","travel","operator-reviewed-physical-purchase-abroad");
 await classify(port,subscription,"expense:entertainment:streaming","entertainment","operator-reviewed-ordinary-online-subscription");
 await port.transaction(async tx=>{
  expect((await tx.purchase(meal))?.allocations).toEqual([{accountId:"expense:travel:abroad",purposeId:"travel",minor:3000}]);
  expect((await tx.purchase(subscription))?.allocations).toEqual([{accountId:"expense:entertainment:streaming",purposeId:"entertainment",minor:1000}]);
  expect((await tx.purchase(uncertain))?.allocations[0].accountId).toBe("expense:unallocated");
  expect((await tx.reviewDecisions(meal))[0]).toMatchObject({payload:{scope:"selected",accountId:"expense:travel:abroad"},affectedIds:[meal]});
  expect((await tx.sourceLines(result.sourceRevisionId)).map(l=>l.payload.description)).toEqual(["SYNTHETIC RESTAURANT","SYNTHETIC ONLINE SUBSCRIPTION","SYNTHETIC FOREIGN PROCESSOR"]);
 });
});
it("T11 posts evidenced interest separately from principal and repayment while rate estimates create no charge",async()=>{
 const port=ledger(),result=await admit(port,[line("SYNTHETIC PURCHASE",100,null),line("INTERESES FINANCIACION",10,null,"taxes_and_charges"),line("SU PAGO",-50,null,"payments")],true);
 expect(result.reviews).toEqual([]);const journals=await port.journals("card-a");
 expect(journals.map(j=>j.kind).sort()).toEqual(["billing","cost","purchase","repayment"]);
 expect(journals.find(j=>j.kind==="cost")?.lines).toEqual(expect.arrayContaining([expect.objectContaining({accountId:"expense:financial:interest",debitMinor:1000,creditMinor:0})]));
 const payment=journals.find(j=>j.kind==="repayment")!;expect(payment.lines.every(l=>!l.accountId.startsWith("expense:"))).toBe(true);
 expect(payment.lines).toEqual(expect.arrayContaining([expect.objectContaining({accountId:"clearing:ARS:unresolved-source",creditMinor:5000})]));
 expect(await port.transaction(async tx=>(await tx.purchase(result.purchaseIds[0]))?.principalMinor)).toBe(10000);
 const estimatesOnly=ledger();await admit(estimatesOnly,[line("SYNTHETIC PURCHASE",100,null),line("SU PAGO",-50,null,"payments")],true);
 expect((await estimatesOnly.journals("card-a")).map(j=>j.kind).sort()).toEqual(["billing","purchase","repayment"]);
});
it("T13 Q28 defaults ordinary appliances to expense and preserves acquisition-period expense after classification",async()=>{
 const port=ledger(),result=await admit(port,[line("SYNTHETIC HOUSEHOLD APPLIANCE",300,null)]);expect(result.reviews).toEqual([]);
 expect(await port.transaction(async tx=>(await tx.purchase(result.purchaseIds[0]))?.allocations)).toEqual([{accountId:"expense:unallocated",purposeId:"unallocated",minor:30000}]);
 await classify(port,result.purchaseIds[0],"expense:home:appliances","home","operator-reviewed-ordinary-household-appliance");
 const journals=await port.journals("card-a"),lines=journals.flatMap(j=>j.lines);
 expect(lines.filter(l=>l.accountId.startsWith("expense:")).reduce((n,l)=>n+l.debitMinor-l.creditMinor,0)).toBe(30000);
 expect(lines.some(l=>l.accountId.startsWith("asset:"))).toBe(false);expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);
 expect(journals.find(j=>j.kind==="replacement")).toMatchObject({effectiveDate:"2026-07-10",recordedAt});
 expect(await port.transaction(async tx=>({account:await tx.account("expense:home:appliances"),purchase:await tx.purchase(result.purchaseIds[0])}))).toMatchObject({account:{type:"expense"},purchase:{principalMinor:30000,allocations:[{accountId:"expense:home:appliances",purposeId:"home",minor:30000}]}});
});
