import {expect,it} from "vitest";
import {reportMonths} from "./report-months";
import type {ReportFact,StatementFact} from "./read-model";
const fact=(kind:ReportFact["kind"],date:string,over:Partial<ReportFact>={}):ReportFact=>({id:kind,purchaseId:null,cardId:"a",kind,merchant:null,accountId:null,purposeId:null,currency:"ARS",minor:100,effectiveDate:date,cycleMonth:"2026-09",sourceLineId:null,statementId:null,coverage:"complete",...over});
it("shares issuer-cycle and acquisition periods without treating closing or payment dates as purchases",()=>{
 const statements=[{current:true,cycleMonth:"2026-09",closingDate:"2026-10-01"},{current:false,cycleMonth:"2026-11",closingDate:"2026-12-01"}] as StatementFact[];
 expect(reportMonths([fact("purchase","2026-09-15"),fact("billing","2026-10-01"),fact("payment","2026-10-10"),fact("cost","2026-10-01"),fact("opening","2026-10-01")],statements)).toEqual(["2026-09"]);
 expect(reportMonths([fact("purchase","2026-08-30"),fact("purchase","2026-09-01"),fact("purchase","2026-12-01",{origin:"issuer_observation"})],statements)).toEqual(["2026-08","2026-09"]);
});

it("includes a posted linked refund's own effective month without inventing a purchase or issuer cycle",()=>{
 expect(reportMonths([fact("purchase","2026-01-15"),fact("credit","2026-04-05",{origin:"ledger",purchaseId:"p",cycleMonth:null,minor:-2000}),fact("credit","2026-05-05",{origin:"issuer_observation",purchaseId:null,cycleMonth:null,minor:-2000})],[])).toEqual(["2026-01","2026-04"]);
});
