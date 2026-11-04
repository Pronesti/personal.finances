import {expect,it} from "vitest";
import {alertModel,bankModel,billedObservations,commitmentModel,creditsModel,floatModel,installmentModel,recurringModel,taxesModel} from "./commitments";
import type {ReportFact,ReportScope,StatementFact} from "../read-model";
const scope:ReportScope={basis:"billed",value:"nominal",tax:"excl",granularity:"month",period:null};
const rates={cpi:{"2026-01":100,"2026-02":110,"2026-03":121},mep:{"2026-01":1000,"2026-02":2000,"2026-03":2000}};
const fact=(id:string,over:Partial<ReportFact>={}):ReportFact=>({id,purchaseId:"purchase",cardId:"card-a",kind:"billing",merchant:"SHOP",accountId:"expense:unallocated",purposeId:null,currency:"ARS",minor:100000,effectiveDate:"2026-01-15",cycleMonth:"2026-02",sourceLineId:"line",statementId:"a-current",coverage:"complete",description:"SHOP",...over});
const statement=(over:Partial<StatementFact>={}):StatementFact=>({id:"a-current",cardId:"card-a",sourceRevisionId:"a-current",current:true,closingDate:"2026-02-01",previousClosingDate:"2026-01-01",dueDate:"2026-02-10",cycleMonth:"2026-02",balanceArsMinor:100000,balanceUsdMinor:0,previousBalanceArsMinor:0,minimumPaymentArsMinor:10000,purchaseLimitArsMinor:1000000,tnaPct:60,temPct:5,...over});
it("supersedes old schedules per actual card while retaining two same-brand card burdens",()=>{
 const result=commitmentModel({schedules:[{cardId:"a",revisionId:"old",current:false,month:"2026-02",amount:900},{cardId:"a",revisionId:"new",current:true,month:"2026-02",amount:100},{cardId:"b",revisionId:"b1",current:true,month:"2026-02",amount:200}],recurring:[],variableHistory:[],startMonth:"2026-02",inflation:0,value:"nominal"});
 expect(result.forecast).toHaveLength(6);expect(result.forecast[0].certain).toBe(300);expect(result.remainingPrincipal).toBe(300);
});
it("counts allocations once as billed observations and excludes financed purchases from recurrence",()=>{
 const rows=[fact("split-a",{journalId:"journal",minor:40000,financed:true}),fact("split-b",{journalId:"journal",minor:60000,financed:true})];
 expect(billedObservations(rows)).toHaveLength(1);expect(billedObservations(rows)[0].ars).toBe(1000);expect(recurringModel(rows,rates)).toEqual([]);
});
it("keeps principal repayment outside money-back and costs outside billed principal",()=>{
 const rows=[fact("purchase"),fact("credit",{kind:"credit",minor:-20000,description:"REFUND"}),fact("payment",{kind:"payment",minor:90000}),fact("interest",{kind:"cost",minor:5000,description:"INTERESES FINANCIACION"})];
 expect(creditsModel(rows,scope,rates).periods[0]).toMatchObject({refund:200,total:200,pctOfSpend:20});
 expect(taxesModel(rows,scope,rates)[0]).toMatchObject({interest:50,total:50,ratePct:6.25});
});
it("converts each constituent month before quarter aggregation",()=>{
 const rows=[fact("jan",{cycleMonth:"2026-01",kind:"cost",description:"IVA"}),fact("feb",{kind:"cost",description:"IVA"})];
 expect(taxesModel(rows,{...scope,value:"usd",granularity:"quarter"},rates)[0].total).toBe(1.5);
});
it("preserves documented day-28 float fallback and due-date purchasing-power model",()=>{
 const rows=[fact("bill")];
 const known=floatModel(rows,[statement()],scope,rates)[0],fallback=floatModel(rows,[statement({dueDate:null})],scope,rates)[0];
 expect(known.avgDays).toBe(26);expect(fallback.avgDays).toBe(44);expect(fallback.gain).toBeCloseTo(110);expect(fallback.gainInstallment).toBe(0);
});
it("uses actual card-specific latest terms and leaves a partial aggregate limit missing",()=>{
 const rows=[statement(),statement({id:"b-current",cardId:"card-b",closingDate:"2026-03-01",cycleMonth:"2026-03",purchaseLimitArsMinor:2000000})];
 const result=bankModel(rows,scope,rates);expect(result[0].limit).toBeNull();expect(result[0].limitByBrand).toEqual({"card-a":10000});expect(result[1].limitByBrand).toEqual({"card-b":20000});
});
it("keeps same-brand active installment plans separate by actual card",()=>{
 const rows=[fact("a",{financed:true,installmentCount:6,installmentNumber:2}),fact("b",{purchaseId:"other",cardId:"card-b",statementId:"b-current",financed:true,installmentCount:3,installmentNumber:1})];
 const result=installmentModel(rows,[statement(),statement({id:"b-current",cardId:"card-b"})],scope,rates);expect(result.plans.map(p=>p.brand).sort()).toEqual(["card-a","card-b"]);expect(result.burden[0].plans).toBe(2);
});

it("keeps retained source alert wording and stable reviewed identity after current facts change",()=>{
 const source={kind:"balance_mismatch",message:"Original source observation",expected:100,actual:99,legacyKey:"balance:2026-01"};
 const result=alertModel([],{journals:[],accounts:[],cards:[],alertStates:[{id:"retained",state:"dismissed",source}]},rates,"es");
 expect(result).toHaveLength(1);expect(result[0]).toMatchObject({key:"retained",state:"dismissed",message:source.message,month:"2026-01"});
});

it("explains opening review codes in both languages while retaining the same code and structured values",()=>{
 const inspection={journals:[],accounts:[],cards:[],reviews:[{id:"review",subjectId:"source",code:"historical_receipt_requires_opening_reconciliation",params:{openingDate:"2026-02-01"},sourceLineIds:[],priorDecisionId:null,state:"open" as const,recordedAt:"2026-03-01T00:00:00Z"}]};
 const en=alertModel([],inspection,rates,"en")[0],es=alertModel([],inspection,rates,"es")[0];expect(en.message).toContain("needs reconciliation with the opening books");expect(es.message).toContain("requiere conciliación");for(const row of [en,es]){expect(row.message).toContain("historical_receipt_requires_opening_reconciliation");expect(row.message).toContain("2026-02-01");}expect(en.key).toBe(es.key);
});

it("retains unlinked payment promotions as money-back without reducing expense tax bases or recurring prices",()=>{
 const rows=[fact("bill",{minor:10000}),fact("tax",{kind:"cost",minor:1000,description:"IVA"}),fact("promo",{kind:"credit",minor:-2000,purchaseId:null,sourceSection:"payments",origin:"issuer_observation",description:"BONIF PROMO"})];
 expect(taxesModel(rows,scope,rates)[0].ratePct).toBe(10);
 expect(creditsModel(rows,scope,rates).periods[0].promo).toBe(20);
 expect(billedObservations(rows).map(row=>row.id)).toEqual(["bill"]);
});

it("values installment burden with selected native-USD and allocated-tax lens while leaving unsupported plan identity unknown",()=>{
 const rows=[fact("ars",{minor:100000,financed:true,purchaseId:null,installmentCount:6,installmentNumber:2}),fact("usd",{minor:1000,currency:"USD",purchaseId:"usd"}),fact("tax",{kind:"cost",minor:210000,description:"IVA"})];
 const result=installmentModel(rows,[statement()],{...scope,value:"usd",tax:"incl"},rates).burden[0];
 expect(result.installment).toBeCloseTo(0.55);
 expect(result.oneOff).toBeCloseTo(11);
 expect(result.plans).toBeNull();
});

it("includes billed native USD and allocated tax in forecast variable history without treating USD recurring as certain",async()=>{
 const {commitmentsData}=await import("./commitments");
 const rows=[fact("ars",{minor:100000,installmentCount:null}),fact("usd",{minor:1000,currency:"USD",purchaseId:"usd",installmentCount:null}),fact("tax",{kind:"cost",minor:210000,description:"IVA"})];
 const result=commitmentsData({facts:rows,statements:[statement()],schedules:[],inspection:{journals:[],accounts:[],cards:[]},scope:{...scope,value:"usd",tax:"incl"},rates,locale:"en"});
 expect(result.forecast[0].estLow).toBeCloseTo(11.55);
 expect(result.forecast[0].estHigh).toBeCloseTo(11.55);
 expect(result.forecast[0].expected).toBe(0);
});
