import {expect,it} from "vitest";
import {timingModel,paceModel} from "./timing";
import type {ReportFact,ReportScope,StatementFact} from "../read-model";
const scope:ReportScope={basis:"purchase",value:"nominal",tax:"excl",granularity:"month",period:null};
const rates={cpi:{},mep:{}};
const f=(id:string,date:string,minor:number,over:Partial<ReportFact>={}):ReportFact=>({id,purchaseId:id,cardId:"same-brand-a",kind:"purchase",merchant:"S",accountId:"food",purposeId:"food",currency:"ARS",minor,effectiveDate:date,cycleMonth:"2026-02",sourceLineId:null,statementId:null,coverage:"complete",...over});
it("median100/300is200, refunds add no visit, installments add no acquisition",()=>{
 const model=timingModel([f("a","2026-01-01",10000),f("b","2026-01-01",30000),f("c","2026-01-02",-5000,{kind:"credit"}),f("bill","2026-02-01",10000,{kind:"billing",purchaseId:"a"})],scope,rates);
 expect(model.medianTicket).toBe(200);expect(model.days).toEqual([{date:"2026-01-01",amount:400,purchaseCount:2},{date:"2026-01-02",amount:-50,purchaseCount:0}]);
});
const statement=(id:string,cardId:string,previousClosingDate:string,closingDate:string):StatementFact=>({id,cardId,sourceRevisionId:id,current:true,previousClosingDate,closingDate,cycleMonth:closingDate.slice(0,7),dueDate:null,balanceArsMinor:null,balanceUsdMinor:null,previousBalanceArsMinor:null,minimumPaymentArsMinor:null,purchaseLimitArsMinor:null,tnaPct:null,temPct:null});
it("same-brand cards keep separate closing windows and completedshortcycles carry forward",()=>{
 const statements=[statement("a1","same-brand-a","2026-01-01","2026-01-03"),statement("b1","same-brand-b","2026-01-02","2026-01-05"),statement("a2","same-brand-a","2026-02-01","2026-02-05")];
 const model=paceModel([f("a","2026-01-03",10000),f("b","2026-01-03",20000,{cardId:"same-brand-b"}),f("a2","2026-02-03",30000)],statements,scope,rates);
 expect(model[0].points.at(-1)?.cumulative).toBe(100);
 expect(model[1].points.at(-1)?.cumulative).toBe(200);
 expect(model[2].priorMedian.map(p=>p.cumulative)).toEqual([0,100,100,100]);
});
