import { expect,it } from "vitest";
import type { ReportFact,ReportScope } from "../read-model";
import { spendRows,spendingModel,merchantModel,moverModel,flowModel,drillModel } from "./spending";
const scope:ReportScope={basis:"purchase",value:"nominal",tax:"excl",granularity:"month",period:null};
const rates={cpi:{"2026-01":100,"2026-02":200},mep:{"2026-01":1000,"2026-02":2000}};
const f=(id:string,over:Partial<ReportFact>={}):ReportFact=>({id,purchaseId:id,cardId:"card-a",kind:"purchase",merchant:"SHOP",accountId:"food",purposeId:"food",currency:"ARS",minor:100000,effectiveDate:"2026-01-15",cycleMonth:"2026-02",sourceLineId:"line",statementId:"statement",coverage:"complete",...over});
it("separates one600purchase from100billing, opening debt and actual payment",()=>{
 const facts=[f("purchase",{minor:60000,purchaseId:"p"}),f("bill",{kind:"billing",minor:10000,purchaseId:"p"}),f("opening",{kind:"opening",minor:90000}),f("payment",{kind:"payment",minor:10000})];
 expect(spendRows(facts,scope,rates)).toEqual([{period:"2026-01",accountId:"food",purposeId:"food",amount:600}]);
 expect(spendRows(facts,{...scope,basis:"billed"},rates)).toEqual([{period:"2026-02",accountId:"food",purposeId:"food",amount:100}]);
});
it("converts constituent months before quarter aggregation",()=>{
 const facts=[f("a"),f("b",{effectiveDate:"2026-02-15"})];
 expect(spendRows(facts,{...scope,granularity:"quarter",value:"usd"},rates)[0].amount).toBe(1.5);
 expect(spendRows(facts,{...scope,granularity:"quarter",value:"real"},rates)[0].amount).toBe(3000);
});
it("nets nativeUSD refunds and keeps ordinary peso exclusion",()=>{
 const facts=[f("a",{currency:"USD",minor:1000}),f("c",{currency:"USD",kind:"credit",minor:-500})];
 expect(spendRows(facts,scope,rates)).toEqual([]);
 expect(spendRows(facts,{...scope,value:"usd"},rates)[0].amount).toBe(5);
});
it("keeps true equal acquisitions distinct and split allocations one purchase",()=>{
 const facts=[f("a",{purchaseId:"one",minor:100}),f("split",{purchaseId:"one",minor:200,accountId:"house"}),f("b",{purchaseId:"two",minor:300}),f("credit",{purchaseId:"one",kind:"credit",minor:-100})];
 expect(spendingModel(facts,scope,rates).purchaseCount).toBe(2);
 expect(drillModel(facts,scope,rates,{accountId:"house",merchant:null}).total).toBe(2);
});
it("requires rates only for selected converted facts and rejects unsafe cents",()=>{
 expect(()=>spendRows([f("a")],{...scope,value:"usd"},{cpi:{},mep:{}})).toThrow();
 expect(()=>spendRows([f("a",{minor:Number.MAX_SAFE_INTEGER+1})],scope,rates)).toThrow("invalid_minor_units");
});
it("allocates actual issuer costs once while excluding repayment from tax base",()=>{
 const facts=[f("p",{minor:10000}),f("bill",{kind:"billing",minor:10000}),f("tax",{kind:"cost",minor:1000}),f("paid",{kind:"payment",minor:10000})];
 expect(spendingModel(facts,scope,rates).total).toBe(100);
 expect(spendingModel(facts,{...scope,tax:"incl"},rates).total).toBeCloseTo(110);
});
it("merchant novelty remains monthly before regrouping and independent of ranking filter",()=>{
 const facts=[f("a"),f("b",{effectiveDate:"2026-02-01"}),f("c",{merchant:"NEW",effectiveDate:"2026-02-01",minor:20000})];
 const model=merchantModel(facts,{...scope,period:"2026-02"},rates);
 expect(model.totals[0]).toMatchObject({merchant:"SHOP",amount:1000});
 expect(model.novelty).toEqual([{period:"2026-01",newAmount:1000,returningAmount:0},{period:"2026-02",newAmount:200,returningAmount:1000}]);
});
it("new category movers use nullpercent and positive net flows reconcile",()=>{
 const facts=[f("a"),f("b",{effectiveDate:"2026-02-01",accountId:"new",minor:20000}),f("refund",{kind:"credit",minor:-100000})];
 expect(moverModel(facts,scope,rates).find(r=>r.accountId==="new")).toMatchObject({before:0,after:200,delta:200,pct:null});
 const flow=flowModel(facts,scope,rates);
 expect(flow.links.filter(l=>l.sourceId.startsWith("card:")).reduce((s,l)=>s+l.amount,0)).toBe(200);
 expect(flow.links.every(l=>l.amount>0)).toBe(true);
});

import {createMemoryLedger} from "../memory";
import {syntheticSeed,purchaseInput,billingInput,paymentInput} from "../test-support";
import {recordPurchase,billInstallment,recordRepayment,correctPurchase} from "../use-cases";
import {purposeMeasuresFromSnapshot} from "./spending";
import type {LedgerPort} from "../port";
async function purposes(port:LedgerPort,ids:string[],currency:"ARS"|"USD"="ARS") {
 const state=await port.transaction(async tx=>({state:await tx.attributionState("card-a",currency),purchases:await Promise.all(ids.map(id=>tx.purchase(id)))}));
 return purposeMeasuresFromSnapshot({journals:await port.journals("card-a"),accounts:syntheticSeed().accounts,purchases:state.purchases.filter(p=>p!==null),state:state.state},{cardId:"card-a",currency,from:"2026-01-01",to:"2026-12-31"});
}
async function twoPurposes(issuer=false) {
 const port=createMemoryLedger(syntheticSeed());
 await recordPurchase(port,purchaseInput({purchaseId:"food",key:"food",principalMinor:10000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000}]}));
 await recordPurchase(port,purchaseInput({purchaseId:"travel",key:"travel",principalMinor:20000,allocations:[{accountId:"expense:travel",purposeId:"travel",minor:20000}]}));
 await billInstallment(port,billingInput({purchaseId:"food",key:"food-bill",amountMinor:10000}));
 await billInstallment(port,billingInput({purchaseId:"travel",key:"travel-bill",amountMinor:20000,effectiveDate:"2026-02-02"}));
 const components=await port.transaction(tx=>tx.billedComponents("ARS","card-a"));
 await recordRepayment(port,paymentInput({amountMinor:15000,issuerAllocations:issuer?[{componentId:components.find(c=>c.purchaseId==="travel")!.id,minor:15000}]:null}));
 return port;
}
it("separates100food/200travel expense from FIFO150payment and150remainingdebt",async()=>{
 const rows=await purposes(await twoPurposes(),["food","travel"]);
 expect(rows.find(r=>r.purposeId==="food")).toEqual({purposeId:"food",expenseMinor:10000,debtMinor:0,repaymentMinor:10000});
 expect(rows.find(r=>r.purposeId==="travel")).toEqual({purposeId:"travel",expenseMinor:20000,debtMinor:15000,repaymentMinor:5000});
});
it("uses explicit issuer attribution instead of FIFO",async()=>{
 const rows=await purposes(await twoPurposes(true),["food","travel"]);
 expect(rows.find(r=>r.purposeId==="food")?.debtMinor).toBe(10000);
 expect(rows.find(r=>r.purposeId==="travel")).toMatchObject({debtMinor:5000,repaymentMinor:15000});
});
it("keeps unbilled principal and negative unappliedcredit distinct from repayments",async()=>{
 const port=createMemoryLedger(syntheticSeed());await recordPurchase(port,purchaseInput());await billInstallment(port,billingInput());await recordRepayment(port,paymentInput({amountMinor:15000}));
 const rows=await purposes(port,["purchase-a"]);
 expect(rows.find(r=>r.purposeId==="unallocated")).toMatchObject({expenseMinor:60000,debtMinor:50000,repaymentMinor:10000});
 expect(rows.find(r=>r.purposeId===null)).toMatchObject({expenseMinor:0,debtMinor:-5000,repaymentMinor:5000});
 expect(rows.reduce((s,r)=>s+r.debtMinor,0)).toBe(45000);
});
it("latest corrected purpose changes historical expense/debt attribution without changing totals",async()=>{
 const port=createMemoryLedger(syntheticSeed()),original=purchaseInput({principalMinor:10000,allocations:[{accountId:"expense:food",purposeId:"food",minor:10000}]});
 await recordPurchase(port,original);await billInstallment(port,billingInput());await recordRepayment(port,paymentInput({amountMinor:5000}));
 await correctPurchase(port,{key:"fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:travel",purposeId:"travel",minor:10000}]},recordedAt:"2026-05-01T00:00:00Z",reason:"reviewed purpose"});
 const rows=await purposes(port,["purchase-a"]);
 expect(rows.find(r=>r.purposeId==="travel")).toEqual({purposeId:"travel",expenseMinor:10000,debtMinor:5000,repaymentMinor:5000});
 expect(rows.reduce((s,r)=>s+r.expenseMinor,0)).toBe(10000);
 expect(rows.reduce((s,r)=>s+r.debtMinor,0)).toBe(5000);
});
it("never combines nativeUSD purpose balances withARS",async()=>{
 const port=createMemoryLedger(syntheticSeed());await recordPurchase(port,purchaseInput());await recordPurchase(port,purchaseInput({key:"usd",purchaseId:"usd",currency:"USD",principalMinor:500,allocations:[{accountId:"expense:travel",purposeId:"travel",minor:500}]}));
 const rows=await purposes(port,["purchase-a","usd"],"USD");
 expect(rows).toEqual([{purposeId:"travel",expenseMinor:500,debtMinor:500,repaymentMinor:0}]);
});
it("retains nativeUSD source rows in ordinary peso drill without adding them to its total",()=>{
 const row=f("usd",{currency:"USD",minor:500});
 expect(drillModel([row],scope,{cpi:{},mep:{}},{accountId:null,merchant:null})).toEqual({rows:[row],total:0});
});
it("merchant firstappearance includes nativeUSD evidence even in ordinarypeso mode",()=>{
 const rows=[f("usd",{currency:"USD",minor:500}),f("ars",{effectiveDate:"2026-02-01"})];
 expect(merchantModel(rows,scope,rates).novelty).toEqual([{period:"2026-02",newAmount:0,returningAmount:1000}]);
 expect(merchantModel(rows,scope,rates).totals[0]).toMatchObject({share:100,cumulativeShare:100});
});
it("keeps financed assets out of expenseflow while retaining their actual debt",async()=>{
 const seed=syntheticSeed(),asset={...seed.accounts.find(a=>a.id==="expense:food")!,id:"asset:equipment",type:"asset" as const};seed.accounts.push(asset);
 const port=createMemoryLedger(seed);await recordPurchase(port,purchaseInput({principalMinor:30000,allocations:[{accountId:asset.id,purposeId:"home",minor:30000}]}));await billInstallment(port,billingInput());await recordRepayment(port,paymentInput({amountMinor:5000}));
 const state=await port.transaction(async tx=>({state:await tx.attributionState("card-a","ARS"),purchase:(await tx.purchase("purchase-a"))!}));
 const rows=purposeMeasuresFromSnapshot({accounts:seed.accounts,journals:await port.journals("card-a"),purchases:[state.purchase],state:state.state},{cardId:"card-a",currency:"ARS",from:"2026-01-01",to:"2026-12-31"});
 expect(rows).toEqual([{purposeId:"home",expenseMinor:0,debtMinor:25000,repaymentMinor:5000}]);
});
it("measures debt at the boundary while expense and repayment remain periodflows",async()=>{
 const port=await twoPurposes();
 const state=await port.transaction(async tx=>({state:await tx.attributionState("card-a","ARS"),purchases:[(await tx.purchase("food"))!,(await tx.purchase("travel"))!]}));
 const snapshot={journals:await port.journals("card-a"),accounts:syntheticSeed().accounts,purchases:state.purchases,state:state.state};
 const before=purposeMeasuresFromSnapshot(snapshot,{cardId:"card-a",currency:"ARS",from:"2026-02-01",to:"2026-02-09"});
 expect(before.reduce((s,r)=>s+r.expenseMinor,0)).toBe(0);expect(before.reduce((s,r)=>s+r.debtMinor,0)).toBe(30000);expect(before.reduce((s,r)=>s+r.repaymentMinor,0)).toBe(0);
 const after=purposeMeasuresFromSnapshot(snapshot,{cardId:"card-a",currency:"ARS",from:"2026-02-01",to:"2026-02-10"});
 expect(after.reduce((s,r)=>s+r.expenseMinor,0)).toBe(0);expect(after.reduce((s,r)=>s+r.debtMinor,0)).toBe(15000);expect(after.reduce((s,r)=>s+r.repaymentMinor,0)).toBe(15000);
});
it("an empty latest attribution revision never resurrects initial payment attribution",async()=>{
 const port=await twoPurposes(),values=await port.transaction(async tx=>({state:await tx.attributionState("card-a","ARS"),purchases:[(await tx.purchase("food"))!,(await tx.purchase("travel"))!]}));
 const payment=values.state.payments[0],latest=Math.max(...values.state.attributionRevisions.map(r=>r.revision));
 values.state.attributionRevisions.push({paymentId:payment.id,revision:latest+1,unappliedMinor:15000});
 const rows=purposeMeasuresFromSnapshot({journals:await port.journals("card-a"),accounts:syntheticSeed().accounts,purchases:values.purchases,state:values.state},{cardId:"card-a",currency:"ARS",from:"2026-01-01",to:"2026-12-31"});
 expect(rows.find(r=>r.purposeId==="food")?.repaymentMinor).toBe(0);expect(rows.find(r=>r.purposeId===null)).toMatchObject({debtMinor:-15000,repaymentMinor:15000});
 expect(rows.reduce((s,r)=>s+r.debtMinor,0)).toBe(15000);
});
import {postJournal} from "../use-cases";
import {balancedJournal} from "../test-support";
it("keeps supported opening obligations explicitly unattributed without inventing expenses",async()=>{
 const port=createMemoryLedger(syntheticSeed());
 await postJournal(port,balancedJournal({id:"opening",commandKey:"opening",kind:"opening",effectiveDate:"2026-01-01",lines:[{accountId:"equity:opening",purchaseId:null,purposeId:null,debitMinor:9000,creditMinor:0},{accountId:"card-a:ARS:billed",purchaseId:null,purposeId:null,debitMinor:0,creditMinor:9000}]}),"opening");
 await recordRepayment(port,paymentInput({amountMinor:5000}));
 expect(await purposes(port,[])).toEqual([{purposeId:null,expenseMinor:0,debtMinor:4000,repaymentMinor:5000}]);
});

it("keeps unlinked payment-section credits out of spending and allocated issuer tax",()=>{
 const facts=[f("purchase",{minor:10000}),f("bill",{kind:"billing",minor:10000}),f("tax",{kind:"cost",minor:1000}),f("promo",{kind:"credit",minor:-2000,purchaseId:null,origin:"issuer_observation",sourceSection:"payments"})];
 for(const basis of ["purchase","billed"] as const){
  const selected={...scope,basis,tax:"incl" as const};
  expect(spendingModel(facts,selected,rates).total).toBeCloseTo(110);
  expect(drillModel(facts,selected,rates,{accountId:null,merchant:null}).rows.some(row=>row.id==="promo")).toBe(false);
 }
 expect(spendingModel([...facts,f("refund",{kind:"credit",minor:-1000,sourceSection:"payments",purchaseId:"purchase"})],{...scope,basis:"billed"},rates).total).toBe(90);
});

it("shows a posted receipt-backed linked refund in its own April purchase and billed periods",()=>{
 const credit=f("refund",{kind:"credit",minor:-2000,origin:"ledger",purchaseId:"p",effectiveDate:"2026-04-05",cycleMonth:null,statementId:null});
 for(const basis of ["purchase","billed"] as const){const selected={...scope,basis,period:"2026-04"};expect(spendRows([credit],selected,rates)).toEqual([{period:"2026-04",accountId:"food",purposeId:"food",amount:-20}]);expect(drillModel([credit],selected,rates,{accountId:null,merchant:null}).total).toBe(-20);}
 expect(()=>spendRows([f("missing-bill",{kind:"billing",origin:"ledger",cycleMonth:null})],{...scope,basis:"billed"},rates)).toThrow("billing_cycle_missing");
 expect(()=>spendRows([f("unlinked",{kind:"credit",origin:"issuer_observation",cycleMonth:null,purchaseId:null})],{...scope,basis:"billed"},rates)).toThrow("billing_cycle_missing");
});
