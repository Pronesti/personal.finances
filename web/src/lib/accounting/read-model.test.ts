import { expect, it } from "vitest";
import { createMemoryReader, loadReportFacts, type ReportFact } from "./read-model";
import { financialFacts, reportMinor, applyMerchantAliases, type FinancialRows } from "./reader-postgres";
const fact:ReportFact={id:"one",purchaseId:"p",cardId:"visa-a",kind:"purchase",merchant:"SHOP",accountId:"expense:food",purposeId:"food",currency:"ARS",minor:10000,effectiveDate:"2026-01-15",cycleMonth:"2026-02",sourceLineId:null,statementId:null,coverage:"complete"};
it("keeps authored ordered alias labels on historical observations without requiring a posted purchase", () => {
 const rows:ReportFact[]=[{...fact,purchaseId:null,origin:"issuer_observation",description:"SHOP PLUS PAYMENT"}];
 applyMerchantAliases(rows,[
  {kind:"merchant",id:"specific",normalizedName:"SHOP PLUS",redirectId:"target",position:0},
  {kind:"merchant",id:"broad",normalizedName:"SHOP",redirectId:"other",position:1},
  {kind:"merchant",id:"target",normalizedName:"CUSTOM LABEL",displayName:"My authored label",redirectId:null},
  {kind:"merchant",id:"other",normalizedName:"OTHER",redirectId:null},
 ],[]);
 expect(rows[0].merchant).toBe("My authored label");
 expect(rows[0].description).toBe("SHOP PLUS PAYMENT");
 expect(rows[0].minor).toBe(10000);
});
it("loads detached validated facts without any SQLite access",async()=>{
 const reader=createMemoryReader({facts:[fact]});const loaded=await loadReportFacts(reader);loaded[0].minor=1;
 expect((await reader.facts())[0].minor).toBe(10000);await reader.close();
});
it("rejects unsafe integer conversions, duplicate IDs and JS Date/date shifts",async()=>{
 expect(()=>reportMinor("9007199254740992")).toThrow("invalid_minor_units");
 expect(reportMinor("-100")).toBe(-100);
 await expect(loadReportFacts(createMemoryReader({facts:[fact,{...fact}]}))).rejects.toThrow("invalid_report_identity");
 await expect(loadReportFacts(createMemoryReader({facts:[{...fact,effectiveDate:"2026-02-30"}]}))).rejects.toThrow("invalid_report_date");
});
it("selects latest actual purchase/credit journals and excludes correction reversals",()=>{
 const journals:FinancialRows['journals']=[
  {id:"old",card_id:"a",currency:"ARS",effective_date:"2026-01-15",kind:"purchase"},
  {id:"reverse",card_id:"a",currency:"ARS",effective_date:"2026-01-15",kind:"reversal"},
  {id:"new",card_id:"a",currency:"ARS",effective_date:"2026-01-15",kind:"replacement"},
  {id:"credit",card_id:"a",currency:"ARS",effective_date:"2026-04-15",kind:"replacement"},
  {id:"bill",card_id:"a",currency:"ARS",effective_date:"2026-02-10",kind:"billing"},
 ];
 const line=(journal_id:string,debit:string,credit:string,account="house")=>({journal_id,ordinal:0,account_id:account,purpose_id:account,purchase_id:"p",debit_minor:debit,credit_minor:credit,type:"expense"});
 const rows:FinancialRows={journals,lines:[line("old","60000","0","food"),line("reverse","0","60000","food"),line("new","60000","0"),line("credit","0","10000")],purchases:[{key:"k",purchaseId:"p",cardId:"a",currency:"ARS",effectiveDate:"2026-01-15",recordedAt:"2026-03-01T00:00:00Z",evidenceIds:["e"],principalMinor:60000,allocations:[{accountId:"house",purposeId:"house",minor:60000}],version:2,journalId:"new"}],billings:[{id:"b",purchaseId:"p",cardId:"a",currency:"ARS",installment:1,amountMinor:10000,effectiveDate:"2026-02-10",purchaseDate:"2026-01-15",journalId:"bill",components:[{id:"c",purposeId:"food",minor:10000}]}],creditJournalIds:["credit"],sources:[]};
 const facts=financialFacts(rows);
 expect(facts.filter(f=>f.kind==="purchase")).toMatchObject([{accountId:"house",minor:60000,effectiveDate:"2026-01-15"}]);
 expect(facts.filter(f=>f.kind==="billing")).toMatchObject([{accountId:"house",purposeId:"house",minor:10000}]);
 expect(facts.filter(f=>f.kind==="credit")).toMatchObject([{accountId:"house",minor:-10000,effectiveDate:"2026-04-15"}]);
 expect(facts.some(f=>f.id.startsWith("old:")||f.id.startsWith("reverse:"))).toBe(false);
});

it("shows actual opening-obligation billing while excluding opening balances from billed spending", () => {
 const rows:FinancialRows={
  journals:[{id:"opening",card_id:"a",currency:"ARS",effective_date:"2026-09-01",kind:"opening"},{id:"next",card_id:"a",currency:"ARS",effective_date:"2026-10-01",kind:"billing"}],
  lines:[],purchases:[],creditJournalIds:[],sources:[],
  openingObligations:[{id:"obligation",cardId:"a",currency:"ARS",openingJournalId:"opening",evidenceIds:["invoice"],originalPrincipalMinor:8000,alreadyBilledMinor:4000,remainingMinor:4000,purchaseDate:"2026-08-15",lastBilledInstallment:1,installmentCount:2,allocations:[{purposeId:null,minor:4000}]}],
  billings:[
   {origin:"opening_balance",id:"opening",journalId:"opening",purchaseId:null,cardId:"a",currency:"ARS",installment:1,amountMinor:5000,effectiveDate:"2026-09-01",purchaseDate:"2026-09-01",components:[{id:"opening:component",purposeId:null,minor:5000}]},
   {origin:"opening_installment",id:"next",journalId:"next",openingObligationId:"obligation",purchaseId:null,cardId:"a",currency:"ARS",installment:2,amountMinor:4000,effectiveDate:"2026-10-01",purchaseDate:"2026-08-15",components:[{id:"next:component",purposeId:null,minor:4000}]},
  ],
 };
 const facts=financialFacts(rows);
 expect(facts.filter(fact=>fact.kind==="billing")).toMatchObject([{origin:"ledger",minor:4000,financed:true,installmentNumber:2,installmentCount:2,purchaseDate:"2026-08-15",purchaseId:null}]);
 expect(facts.filter(fact=>fact.kind==="purchase")).toEqual([]);
});

import {withTestLedger,purchaseInput,billingInput,paymentInput} from "./test-support";
import {recordPurchase,billInstallment,recordRepayment,recordLinkedCredit,correctPurchase} from "./use-cases";
import {createPostgresReader} from "./reader-postgres";
const pgEnabled=process.env.ACCOUNTING_PG_TESTS==="1";
if(pgEnabled&&!process.env.ACCOUNTING_TEST_DATABASE_URL)throw new Error("missing_ACCOUNTING_TEST_DATABASE_URL");
it.skipIf(!pgEnabled)("reads real immutable corrected financial rows in one PGsnapshot",async()=>withTestLedger(async(port,context)=>{
 const original=purchaseInput();await recordPurchase(port,original);await billInstallment(port,billingInput());await recordRepayment(port,paymentInput({amountMinor:5000}));
 await recordLinkedCredit(port,{key:"credit",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",amountMinor:10000,billedReductionMinor:0,unbilledReductionMinor:10000,effectiveDate:"2026-04-01",recordedAt:"2026-04-01T12:00:00Z",evidenceIds:["synthetic:e1"]});
 await correctPurchase(port,{key:"fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-05-01T12:00:00Z",reason:"reviewed"});
 const reader=createPostgresReader(context.connectionString,context.schema);
 try{
  const facts=await reader.facts();
  const inspection=await reader.inspection();expect(inspection.cards).toEqual([{id:"card-a",displayName:"card-a"}]);expect(inspection.journals.every(j=>typeof j.effectiveDate==="string"&&j.recordedAt.endsWith("Z"))).toBe(true);
  expect(facts.filter(f=>f.kind==="purchase")).toMatchObject([{accountId:"expense:food",minor:60000,effectiveDate:"2026-01-15"}]);
  expect(facts.filter(f=>f.kind==="billing")).toMatchObject([{accountId:"expense:food",minor:10000}]);
  expect(facts.filter(f=>f.kind==="credit")).toMatchObject([{accountId:"expense:food",minor:-10000,effectiveDate:"2026-04-01"}]);
  const rows=await reader.purposeMeasures!({cardId:"card-a",currency:"ARS",from:"2026-01-01",to:"2026-12-31"});
  expect(rows.find(r=>r.purposeId==="food")).toEqual({purposeId:"food",expenseMinor:50000,debtMinor:45000,repaymentMinor:5000});
  expect(await reader.statements()).toEqual([]);
  expect(await reader.receiptFacts()).toEqual({receipts:[],items:[],rawItems:[]});
  expect(await reader.receiptAllocations()).toEqual([]);
  // A request reader remains pinned after a later accepted write; a new reader sees it.
  await recordPurchase(port,purchaseInput({key:"later",purchaseId:"later",principalMinor:100,allocations:[{accountId:"expense:travel",purposeId:"travel",minor:100}]}));
  expect(await reader.facts()).toEqual(facts);
  expect(await reader.inspection()).toEqual(inspection);
  const next=createPostgresReader(context.connectionString,context.schema);try{expect((await next.facts()).filter(f=>f.kind==="purchase")).toHaveLength(2);}finally{await next.close();}
 }finally{await reader.close();}
}));

it("resolves current accepted merchant aliases without changing factidentity/amount",()=>{
 const facts=[{...fact}];applyMerchantAliases(facts,[{kind:"merchant",id:"old",normalizedName:"OLD",redirectId:"new"},{kind:"merchant",id:"new",normalizedName:"CUSTOM NAME",redirectId:null}],[{kind:"merchant_purchase",id:"p",purchaseId:"p",cardId:"visa-a",merchantId:"old",sourceLineId:"line"}]);
 expect(facts[0]).toEqual({...fact,merchant:"CUSTOM NAME"});
});
import {importReceipt} from "./receipt-import";
import {receiptExtraction} from "./receipt-test-support";
import {createMemoryDocuments} from "./documents";
import {reconcileReceipt} from "./linking";
import {createProductTx,reviewReceiptItem} from "./review";
it.skipIf(!pgEnabled)("reads actual numeric receipt/product identities and includes only reviewed product matches",async()=>withTestLedger(async(port,context)=>{
 const imported=await importReceipt(port,createMemoryDocuments(),{key:"receipt",bytes:Buffer.from("%PDF-synthetic-reader-receipt"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:reader"});
 const before=createPostgresReader(context.connectionString,context.schema);try{
  const data=await before.receiptFacts();expect(data.receipts).toMatchObject([{id:1,totalCents:8000}]);expect(data.items).toEqual([]);
  expect(data.rawItems).toMatchObject([{receiptId:1,grossCents:10000,discountCents:-2000,hasM:true,hasA:false}]);
  expect(data.rawItems?.[0]).not.toHaveProperty("productId");
 }finally{await before.close();}
 const productId=await port.transaction(tx=>createProductTx(tx,{name:"Mi producto",category:"other",unit:"un",reviewed:true}));
 const line=await port.transaction(async tx=>(await tx.sourceLines(imported.sourceRevisionId))[0]);
 await reviewReceiptItem(port,{key:"review",receiptRevisionId:imported.sourceRevisionId,sourceLineId:line.id,productId,recordedAt:"2026-01-17T12:00:00Z"});
 await reconcileReceipt(port,{key:"link-items",receiptRevisionId:imported.sourceRevisionId,cardId:"card-a",purchaseId:null,paymentVerified:true,allocation:null,itemAllocations:[{sourceLineId:line.id,accountId:"expense:food",purposeId:"food",minor:8000}],recordedAt:"2026-01-18T12:00:00Z"});
 const after=createPostgresReader(context.connectionString,context.schema);try{
  const data=await after.receiptFacts();expect(data.items).toMatchObject([{receiptId:1,productId:Number(productId),productName:"Mi producto",grossCents:10000,discountCents:-2000,hasM:true,hasA:false}]);
  expect(await after.receiptAllocations()).toEqual([{receiptId:1,itemId:line.id,accountId:"expense:food",purposeId:"food",netMinor:8000,reviewed:true}]);
 }finally{await after.close();}
}));

import {importStatement} from "./statement-import";
it.skipIf(!pgEnabled)("reads actual statement terms, cycle, merchant and schedule provenance",async()=>withTestLedger(async(port,context)=>{
 const json={file:"synthetic_2026.pdf",brand:"visa",period:{closing_date:"2026-01-31",previous_closing_date:"2026-01-01",due_date:"2026-02-10"},balances:{current_ars:100,current_usd:5,previous_ars:200,minimum_payment_ars:10},limits:{purchase:1000},rates:{annual_nominal_ars:20,monthly_effective_ars:2},upcoming_installments:[{month:"2026-03",amount_ars:80}],transactions:[{section:"purchases",date:"2026-01-15",description:"MERPAGO*COTO",ars:100,usd:null,installment_number:null,installment_count:null}]};
 const imported=await importStatement(port,createMemoryDocuments(),{key:"statement",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic-report-statement"),rawJson:Buffer.from(JSON.stringify(json)),json,recordedAt:"2026-02-01T00:00:00Z",appRevision:"synthetic:reader"});
 const reader=createPostgresReader(context.connectionString,context.schema);try{
  expect(await reader.statements()).toMatchObject([{id:imported.sourceRevisionId,cardId:"card-a",current:true,closingDate:"2026-01-31",previousClosingDate:"2026-01-01",dueDate:"2026-02-10",cycleMonth:"2026-01",balanceArsMinor:10000,balanceUsdMinor:500,previousBalanceArsMinor:20000,minimumPaymentArsMinor:1000,purchaseLimitArsMinor:100000,tnaPct:20,temPct:2}]);
  expect(await reader.schedules()).toEqual([{cardId:"card-a",revisionId:imported.sourceRevisionId,current:true,month:"2026-03",amount:80}]);
  const facts=await reader.facts();expect(facts.filter(f=>f.kind==="purchase")).toMatchObject([{merchant:"COTO",statementId:imported.sourceRevisionId,minor:10000,cycleMonth:"2026-01",coverage:"complete"}]);
  expect(facts.every(f=>f.kind!=="opening"&&f.kind!=="cost")).toBe(true);
 }finally{await reader.close();}
}));
import {spendRows} from "./reports/spending";
it.skipIf(!pgEnabled)("preserves issuer installment3of6 as billed observation without inventing acquisition, and deduplicates later billing",async()=>withTestLedger(async(port,context)=>{
 const json={file:"synthetic_2026.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",date:"2025-11-15",description:"SYNTHETIC INSTALLMENT",ars:100,usd:null,installment_number:3,installment_count:6}]};
 await importStatement(port,createMemoryDocuments(),{key:"partial",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-partial-installment-reader"),rawJson:Buffer.from(JSON.stringify(json)),json,recordedAt:"2026-02-01T00:00:00Z",appRevision:"synthetic:reader"});
 const first=createPostgresReader(context.connectionString,context.schema);let lineId:string;
 try{
  const facts=await first.facts();expect(facts).toMatchObject([{kind:"billing",minor:10000,origin:"issuer_observation",installmentNumber:3,installmentCount:6,coverage:"uncertain"}]);lineId=facts[0].sourceLineId!;
  const scope={basis:"billed" as const,value:"nominal" as const,tax:"excl" as const,granularity:"month" as const,period:null};
  expect(spendRows(facts,scope,{cpi:{},mep:{}})[0].amount).toBe(100);expect(spendRows(facts,{...scope,basis:"purchase"},{cpi:{},mep:{}})).toEqual([]);
  expect((await first.inspection()).journals).toEqual([]);
 }finally{await first.close();}
 // Additional synthetic acquisition evidence establishes principal; the n/N line alone did not.
 await recordPurchase(port,purchaseInput({evidenceIds:["synthetic:e1"],effectiveDate:"2025-11-15"}));
 await billInstallment(port,billingInput({evidenceIds:[lineId!],installment:3,effectiveDate:"2026-01-31"}));
 const second=createPostgresReader(context.connectionString,context.schema);try{
  const bills=(await second.facts()).filter(f=>f.kind==="billing");expect(bills).toHaveLength(1);expect(bills[0]).toMatchObject({origin:"ledger",minor:10000,sourceLineId:lineId!});
 }finally{await second.close();}
}));

it("applies ordered self-target aliases as prefixes and lets specific self aliases beat broad redirects",()=>{
 const rows=[{...fact,description:"PERSONAL FLOW 300063822681002",purchaseId:null},{...fact,id:"two",description:"SHOP PLUS PAYMENT",purchaseId:null}];
 applyMerchantAliases(rows,[
  {kind:"merchant",id:"personal",normalizedName:"PERSONAL",displayName:"PERSONAL",redirectId:null,position:0},
  {kind:"merchant",id:"specific",normalizedName:"SHOP PLUS",displayName:"SHOP PLUS",redirectId:null,position:1},
  {kind:"merchant",id:"broad",normalizedName:"SHOP",redirectId:"other",position:2},
  {kind:"merchant",id:"other",normalizedName:"OTHER",redirectId:null},
 ],[]);
 expect(rows.map(row=>row.merchant)).toEqual(["PERSONAL","SHOP PLUS"]);
 expect(rows[0].description).toBe("PERSONAL FLOW 300063822681002");
});
