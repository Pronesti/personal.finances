import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createMemoryLedger} from "../../web/src/lib/accounting/memory";
import {createMemoryDocuments} from "../../web/src/lib/accounting/documents";
import {baseCatalog,cardAccounts,purposeGroups,resolveLabel} from "../../web/src/lib/accounting/catalog";
import {recordPurchase,billInstallment,recordRepayment,recordLinkedCredit,correctPurchase,postJournal} from "../../web/src/lib/accounting/use-cases";
import {registerOpeningObligation,billOpeningInstallment} from "../../web/src/lib/accounting/opening-obligations";
import {splitMinor} from "../../web/src/lib/accounting/purchases";
import {allocateOldestBilled,replayAttributions} from "../../web/src/lib/accounting/attribution";
import {importStatement} from "../../web/src/lib/accounting/statement-import";
import {sourcePayloadDigest,sourceKey,sourceLineId,sourceAmountMinor} from "../../web/src/lib/accounting/evidence";
import {chargeKey,chargeFingerprint} from "../../web/src/lib/fingerprint";
import {parseRowsText} from "../../web/src/lib/receipts/rows";
import {parseRows} from "../../web/src/lib/receipts/parse";
import {verify} from "../../web/src/lib/receipts/verify";
import {importReceipt,ReceiptImportRejected} from "../../web/src/lib/accounting/receipt-import";
import {reconcileReceipt} from "../../web/src/lib/accounting/linking";
import {createProductTx,reviewReceiptItem,applyReview} from "../../web/src/lib/accounting/review";
import {valuedFacts,spendingModel} from "../../web/src/lib/accounting/reports/spending";
import {currencyUiModel} from "../../web/src/lib/accounting/spending-ui-model";
import {detectRecurring} from "../../web/src/lib/recurring";
import {project} from "../../web/src/lib/projection";
import {buildAnalytics} from "../../web/src/lib/receipts/analytics";
import {saveAccountName,saveGroup} from "../../web/src/lib/accounting/catalog-service";
import {wireName} from "../../web/src/lib/llm";
import {parseModes,parseGranularity,resolvePeriod} from "../../web/src/lib/scope";
import {CHROME} from "../../web/src/lib/chrome";
import {CHART_THEMES} from "../../web/src/lib/colors";
import {fmtMoney,fmtPct} from "../../web/src/lib/format";
import {fmtMoneyCents} from "../../web/src/lib/receipts/money";
import {reportSnapshot} from "./report-contract";
import {recordHistoricalAssociation} from "../../web/src/lib/accounting/historical-links";
import {postHistoricalRefund} from "../../web/src/lib/accounting/historical-refunds";
import type {LedgerPort} from "../../web/src/lib/accounting/port";
import type {ReportFact,ReportScope} from "../../web/src/lib/accounting/read-model";

const root=process.argv[2],files=path.join(root,"fixtures");
const json=(name:string)=>JSON.parse(fs.readFileSync(path.join(files,name),"utf8"));
const text=(name:string)=>fs.readFileSync(path.join(files,name),"utf8");
const e=json("outcomes.json"),a=json("algorithm-cases.json"),cards=json("cards.json"),checks:string[]=[];
const date="2026-01-16T12:00:00Z",evidence=["synthetic:e1"],card="synthetic-visa-a";
function equal(id:string,actual:unknown,expected:unknown){assert.deepStrictEqual(actual,expected,id);checks.push(id);}
function close(id:string,actual:number,expected:number){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-9*Math.max(1,Math.abs(expected)),`${id}: ${actual} != ${expected}`);checks.push(id);}
const memory=()=>createMemoryLedger({accounts:[...baseCatalog(),...cards.flatMap((c:any)=>cardAccounts(c.id,c.displayName))],cardIds:cards.map((c:any)=>c.id),evidenceIds:evidence});
async function totals(p:LedgerPort,currency="ARS"){
 const result={expenseMinor:0,billedMinor:0,unbilledMinor:0,clearingMinor:0};
 for(const j of await p.journals(card)){if(j.currency!==currency)continue;for(const l of j.lines){const net=l.debitMinor-l.creditMinor;if(l.accountId.startsWith("expense:"))result.expenseMinor+=net;if(l.accountId===`${card}:${currency}:billed`)result.billedMinor-=net;if(l.accountId===`${card}:${currency}:unbilled`)result.unbilledMinor-=net;if(l.accountId===`clearing:${currency}:unresolved-source`)result.clearingMinor+=net;}}
 return result;
}
async function imports(){
 for(const brand of ["visa","mastercard","mercadopago"]){
  const p=memory(),docs=createMemoryDocuments(),source=json(`${brand}.expected.json`),pdf=fs.readFileSync(path.join(files,"pdf",source.file));
  const input={key:"first",cardId:card,filename:source.file,pdf,json:source,rawJson:Buffer.from(JSON.stringify(source)),recordedAt:date,appRevision:"synthetic:rebuild-v1"};
  const result=await importStatement(p,docs,input),expected=e.imports[brand];
  equal(`import-${brand}-purchases`,result.purchaseIds.length,expected.purchases);equal(`import-${brand}-journals`,(await p.journals(card)).length,expected.journals);equal(`import-${brand}-reviews`,result.reviews.map(r=>r.code),expected.reviewCodes);
  if(expected.ARS)equal(`import-${brand}-ARS`,await totals(p),expected.ARS);
  if(expected.USD)equal(`import-${brand}-USD`,await totals(p,"USD"),expected.USD);
  equal(`import-${brand}-source-fields`,await p.transaction(async tx=>(await tx.sourceLines(result.sourceRevisionId)).map(l=>l.payload)),source.transactions);
  const renamed={...source,file:"renamed_2026.pdf"};
  const replay=await importStatement(p,docs,{...input,key:"rename",filename:renamed.file,json:renamed,rawJson:Buffer.from(JSON.stringify(renamed))});
  equal(`import-${brand}-renamed-replay`,[replay.duplicate,replay.sourceRevisionId===result.sourceRevisionId,replay.postedJournalIds.length],[true,true,0]);
  if(brand==="visa"){
   const changed=structuredClone(source);changed.transactions[0].ars=101;changed.balances.current_ars=101;changed.declared_totals.forEach((r:any)=>{r.ars=101;});
   const revision=await importStatement(p,docs,{...input,key:"revision",json:changed,rawJson:Buffer.from(JSON.stringify(changed))});
   equal("revision-pending",await p.transaction(async tx=>(await tx.sourceRevision(revision.sourceRevisionId))?.admission),"pending");equal("revision-reviews",revision.reviews.map(r=>r.code),e.imports.revision.reviewCodes);equal("revision-no-postings",revision.postedJournalIds,[]);equal("revision-accepted-current-unchanged",await p.transaction(async tx=>(await tx.currentStatementRevision(card))?.id),result.sourceRevisionId);
  }
 }
 const source=json("visa.expected.json"),pdf=fs.readFileSync(path.join(files,"pdf",source.file));
 for(const kind of ["conflictingTotals","dualPurchase","dualRepayment","unsupportedJsonBrand"]){
  const s=structuredClone(source);s.declared_totals=[];s.transactions=[s.transactions[0]];
  if(kind==="conflictingTotals")s.declared_totals=[{concept:"TOTAL CONSUMOS DE SYNTHETIC PERSON",block:1,ars:100.01,usd:null}];
  if(kind==="dualPurchase")s.transactions[0].usd=5;
  if(kind==="dualRepayment"){s.transactions[0].section="payments";s.transactions[0].description="SU PAGO EN PESOS TC 1000,00";s.transactions[0].ars=-100;s.transactions[0].usd=-5;}
  if(kind==="unsupportedJsonBrand")s.brand="synthetic-unknown";
  const p=memory(),r=await importStatement(p,createMemoryDocuments(),{key:kind,cardId:card,filename:s.file,pdf,json:s,rawJson:Buffer.from(JSON.stringify(s)),recordedAt:date,appRevision:"synthetic:rebuild-v1"});
  equal(`${kind}-journals`,(await p.journals(card)).length,e.imports[kind].journals);equal(`${kind}-reviews`,r.reviews.map(x=>x.code),e.imports[kind].reviewCodes??[]);
  if(e.imports[kind].admission)equal(`${kind}-admission`,await p.transaction(async tx=>(await tx.sourceRevision(r.sourceRevisionId))?.admission),e.imports[kind].admission);
 }
}
async function ledger(){
 const p=memory(),l=e.ledger;
 const purchase={key:"p1",purchaseId:"purchase-1",cardId:card,currency:"ARS" as const,effectiveDate:"2026-01-15",recordedAt:date,evidenceIds:evidence,principalMinor:l.purchaseMinor,allocations:l.initialAllocations};
 await recordPurchase(p,purchase);equal("ledger-after-purchase",await totals(p),l.afterPurchase);
 const billing={key:"b1",purchaseId:purchase.purchaseId,cardId:card,currency:"ARS" as const,installment:1,amountMinor:l.billingMinor,effectiveDate:"2026-02-01",recordedAt:"2026-02-02T12:00:00Z",evidenceIds:evidence};
 await billInstallment(p,billing);equal("ledger-after-billing",await totals(p),l.afterBilling);equal("billing-cent-distribution",(await p.transaction(tx=>tx.attributionState(card,"ARS"))).billings[0].components.map(c=>c.minor),e.allocation.shares);
 await recordRepayment(p,{key:"payment",cardId:card,currency:"ARS",amountMinor:l.paymentMinor,effectiveDate:"2026-02-10",recordedAt:"2026-02-11T12:00:00Z",evidenceIds:evidence,issuerAllocations:null});equal("ledger-after-payment",await totals(p),l.afterPayment);
 await recordLinkedCredit(p,{key:"credit",purchaseId:purchase.purchaseId,cardId:card,currency:"ARS",...l.credit,effectiveDate:l.creditEffectiveDate,recordedAt:"2026-04-02T12:00:00Z",evidenceIds:evidence});equal("ledger-after-credit",await totals(p),l.afterCredit);
 const correction={key:"correction",cardId:card,purchaseId:purchase.purchaseId,expectedVersion:1,replacement:{...purchase,allocations:l.replacementAllocations},recordedAt:l.correctionRecordedAt,reason:"Synthetic reviewed receipt classification"};
 await correctPurchase(p,correction);equal("ledger-after-correction",await totals(p),l.afterCorrection);equal("correction-current-version",(await p.transaction(tx=>tx.purchase(purchase.purchaseId)))?.version,l.currentVersion);
 const journals=await p.journals(card);equal("correction-journal-history",journals.length,l.journalsAfterCorrection);
 equal("correction-original-period",journals.filter(j=>j.kind==="replacement").map(j=>[j.effectiveDate,j.recordedAt]),[[l.correctionEffectiveDate,l.correctionRecordedAt],[l.creditEffectiveDate,l.correctionRecordedAt]]);
 const byPurpose:Record<string,number>={};for(const j of journals)for(const line of j.lines)if(line.accountId.startsWith("expense:"))byPurpose[line.purposeId!]=(byPurpose[line.purposeId!]??0)+line.debitMinor-line.creditMinor;
 equal("correction-expense-purpose",Object.fromEntries(Object.entries(byPurpose).filter(([,n])=>n)),l.currentExpenseByPurpose);
 equal("correction-outstanding-components",Object.fromEntries((await p.transaction(tx=>tx.billedComponents("ARS",card))).map(c=>[c.purposeId,c.outstandingMinor])),l.outstandingByPurpose);
 equal("correction-replay",(await correctPurchase(p,correction)).status,"duplicate");equal("correction-replay-no-extra-journals",(await p.journals(card)).length,l.journalsAfterCorrection);
 await assert.rejects(()=>correctPurchase(p,{...correction,key:"stale"}),{code:e.errors.staleVersion});checks.push("stale-version-refused");
 const changed={...purchase,principalMinor:70000,allocations:[{accountId:"expense:unallocated",purposeId:"unallocated",minor:70000}]};
 equal("changed-principal-requires-review",(await correctPurchase(p,{...correction,key:"changed-principal",expectedVersion:2,replacement:changed})).reviewCode,e.errors.changedPrincipal);
 equal("changed-principal-no-partial-posting",(await p.journals(card)).length,l.journalsAfterCorrection);
}
async function receipts(){
 const valid=text("receipt-valid.rows.txt"),broken=text("receipt-one-cent-error.rows.txt"),parsed=parseRows(parseRowsText(valid)),report=verify(parsed);
 equal("receipt-cent-verification",report.ok,true);equal("receipt-net-items",parsed.items.map(i=>i.lineTotalCents!+i.discounts.reduce((s,d)=>s+d.amountCents,0)),e.receipt.itemNetMinor);equal("receipt-packaged-units",parsed.items.map(i=>i.unit),e.receipt.units);equal("receipt-one-cent-fails",verify(parseRows(parseRowsText(broken))).ok,false);
 const bytes=fs.readFileSync(path.join(files,"pdf/synthetic_coto.pdf")),p=memory(),docs=createMemoryDocuments();
 const extraction={parsed:parseRows(parseRowsText(broken)),rowsText:broken,report:verify(parseRows(parseRowsText(broken))),scale:3};
 let rejected:ReceiptImportRejected|undefined;try{await importReceipt(p,docs,{key:"bad",bytes,extraction,correctedRowsText:null,recordedAt:date,appRevision:"synthetic:rebuild-v1"});}catch(error){if(!(error instanceof ReceiptImportRejected))throw error;rejected=error;}
 assert.ok(rejected);equal("receipt-rejected-code",rejected.code,e.receipt.errorCode);equal("receipt-rejection-no-purchase",(await p.journals(card)).length,0);
 const admitted=await importReceipt(p,docs,{key:"fixed",bytes,extraction,correctedRowsText:valid,recordedAt:date,appRevision:"synthetic:rebuild-v1"});
 equal("receipt-unfunded-review",admitted.reviews.map(r=>r.code),[e.receipt.unfundedReview]);
 await p.transaction(async tx=>{const f=(await tx.receiptFacts(admitted.sourceRevisionId))!;equal("receipt-correction-original-retained",(await docs.read(f.originalRowsObject)).toString(),broken);equal("receipt-correction-new-retained",(await docs.read(f.correctedRowsObject!)).toString(),valid);equal("receipt-correction-chain",(await tx.sourceRevision(admitted.sourceRevisionId))?.previousRevisionId,rejected!.sourceRevisionId);equal("receipt-stable-numeric-id",f.receiptId,(await tx.receiptFacts(rejected!.sourceRevisionId))?.receiptId);});
 await reconcileReceipt(p,{key:"fund",receiptRevisionId:admitted.sourceRevisionId,cardId:card,paymentVerified:true,purchaseId:null,allocation:null,recordedAt:date});equal("receipt-first-principal",(await totals(p)).expenseMinor,13000);
 for(let i=0;i<parsed.items.length;i++){
  const id=await p.transaction(tx=>createProductTx(tx,{name:`Reviewed synthetic ${i}`,category:i?"personal_care":"pantry",unit:"un",reviewed:true}));
  await reviewReceiptItem(p,{key:`item-${i}`,receiptRevisionId:admitted.sourceRevisionId,sourceLineId:sourceLineId(admitted.sourceRevisionId,i+1),productId:id,recordedAt:date});
 }
 const item={sourceLineId:sourceLineId(admitted.sourceRevisionId,1),accountId:"expense:food:groceries:pantry",purposeId:"food",minor:8000};
 await reconcileReceipt(p,{key:"partial",receiptRevisionId:admitted.sourceRevisionId,cardId:null,paymentVerified:false,purchaseId:null,allocation:null,itemAllocations:[item],recordedAt:date});
 const receiptId=await p.transaction(async tx=>(await tx.receiptFacts(admitted.sourceRevisionId))!.receiptId);
 equal("receipt-partial-unallocated",(await p.transaction(tx=>tx.purchase(`receipt-purchase:${receiptId}`)))?.allocations.map(a=>a.minor),[8000,5000]);
 await reconcileReceipt(p,{key:"full",receiptRevisionId:admitted.sourceRevisionId,cardId:null,paymentVerified:false,purchaseId:null,allocation:null,itemAllocations:[item,{sourceLineId:sourceLineId(admitted.sourceRevisionId,2),accountId:"expense:personal:hygiene",purposeId:"personal",minor:5000}],recordedAt:date});equal("receipt-allocation-conserves-expense",(await totals(p)).expenseMinor,13000);
 const s=json("visa.expected.json");s.transactions=[{...s.transactions[0],description:"COTO",ars:130,usd:null,date:"2026-01-15",voucher:"990004"}];s.declared_totals=[];s.balances.current_ars=130;s.balances.current_usd=0;
 const result=await importStatement(p,docs,{key:"receipt-bill",cardId:card,filename:s.file,pdf:fs.readFileSync(path.join(files,"pdf",s.file)),json:s,rawJson:Buffer.from(JSON.stringify(s)),recordedAt:"2026-02-02T12:00:00Z",appRevision:"synthetic:rebuild-v1"});
 equal("receipt-then-statement-no-duplicate-expense",await totals(p),{expenseMinor:13000,billedMinor:13000,unbilledMinor:0,clearingMinor:0});equal("receipt-statement-identity",result.purchaseIds,[`receipt-purchase:${receiptId}`]);
}
async function opening(){
 const p=memory(),o=e.opening;
 await postJournal(p,{id:"opening-journal",commandKey:"opening",cardId:card,currency:"ARS",effectiveDate:"2026-02-01",recordedAt:"2026-02-02T12:00:00Z",kind:"opening",reversesId:null,evidenceIds:evidence,lines:[{accountId:"equity:opening",debitMinor:o.principalMinor,creditMinor:0,purchaseId:null,purposeId:null},{accountId:`${card}:ARS:unbilled`,debitMinor:0,creditMinor:o.principalMinor,purchaseId:null,purposeId:null}]},"synthetic-opening");
 await registerOpeningObligation(p,{id:"obligation",cardId:card,currency:"ARS",openingJournalId:"opening-journal",evidenceIds:evidence,originalPrincipalMinor:12000,alreadyBilledMinor:0,remainingMinor:12000,purchaseDate:"2026-01-15",lastBilledInstallment:0,installmentCount:2,allocations:[{purposeId:"food",minor:12000}]});
 const b={key:"opening-bill",openingObligationId:"obligation",cardId:card,currency:"ARS" as const,installment:1,amountMinor:6000,effectiveDate:"2026-03-01",recordedAt:"2026-03-02T12:00:00Z",evidenceIds:evidence};
 await billOpeningInstallment(p,b);equal("opening-billing-no-new-expense",await totals(p),o.afterBilling);equal("opening-billing-replay",(await billOpeningInstallment(p,b)).status,"duplicate");equal("opening-journal-count",(await p.journals(card)).length,o.journals);
 equal("opening-excess-review",(await billOpeningInstallment(p,{...b,key:"excess",installment:2,amountMinor:7000})).reviewCode,"billing_exceeds_opening_remaining");
}
async function algorithms(){
 equal("allocation-remainder-order",splitMinor(e.allocation.amount,e.allocation.weights),e.allocation.shares);
 equal("oldest-billed-three-tiebreakers",allocateOldestBilled(a.oldestBilled.amountMinor,a.oldestBilled.components),a.oldestBilled.expected);
 for(const name of ["partialIssuer","reservedIssuer"])equal(name,replayAttributions({...a[name],credits:[],attributions:[],componentRevisions:[],attributionRevisions:[]}),a[name].expected);
 const refs=json("references.json"),scope:ReportScope={basis:"purchase",value:"nominal",tax:"excl",granularity:"month",period:null};
 const f=(id:string,currency:"ARS"|"USD",minor:number):ReportFact=>({id,purchaseId:id,origin:"ledger",cardId:card,kind:"purchase",merchant:id,accountId:"expense:unallocated",purposeId:"unallocated",currency,minor,effectiveDate:e.reports.purchaseDate,cycleMonth:e.reports.cycleMonth,sourceLineId:null,statementId:null,coverage:"complete"});
 const facts=[f("ars","ARS",e.reports.inputArsMinor),f("usd","USD",e.reports.inputUsdMinor)];
 close("report-ordinary-peso",spendingModel(facts,scope,refs).total,e.reports.nominalArsMajor);close("report-real-peso",spendingModel(facts,{...scope,value:"real"},refs).total,e.reports.realArsMajor);close("report-usd",spendingModel(facts,{...scope,value:"usd"},refs).total,e.reports.usdMajor);
 const currency=currencyUiModel(facts,scope,refs)[0];equal("report-currency-peso-lens",{arsBilled:currency.arsBilled,usdBilled:currency.usdBilled},e.reports.currencyNominalArsMajor);
 close("report-billed-month-rate",spendingModel(facts.map(f=>({...f,kind:"billing" as const})),{...scope,basis:"billed",value:"usd"},refs).total,e.reports.billedUsdMajor);
 const quarterFacts=[f("january","ARS",100000),{...f("february","ARS",100000),effectiveDate:"2026-02-15"}],quarterRates={cpi:{"2026-01":100,"2026-02":200},mep:{"2026-01":1000,"2026-02":2000}};
 close("quarter-converts-months-before-usd-sum",spendingModel(quarterFacts,{...scope,granularity:"quarter",value:"usd"},quarterRates).total,e.reports.quarterConstituentUsdMajor);close("quarter-converts-months-before-real-sum",spendingModel(quarterFacts,{...scope,granularity:"quarter",value:"real"},quarterRates).total,e.reports.quarterConstituentRealArsMajor);
 const forecast=project({...a.forecast,mode:"nominal"});equal("forecast-six-months",forecast.length,6);for(const [key,n]of Object.entries(a.forecast.expectedNominalFirst))typeof n==="number"?close(`forecast-first-${key}`,forecast[0][key as keyof typeof forecast[0]] as number,n):equal(`forecast-first-${key}`,forecast[0][key as keyof typeof forecast[0]],n);
 const real=project({...a.forecast,mode:"real"})[0];for(const [key,n]of Object.entries(a.forecast.expectedRealFirst))if(typeof n==="number")close(`forecast-real-${key}`,real[key as keyof typeof real] as number,n);
 for(const [key,n]of Object.entries(a.forecast.expectedNominalLast))typeof n==="number"?close(`forecast-last-${key}`,forecast[5][key as keyof typeof forecast[0]] as number,n):equal(`forecast-last-${key}`,forecast[5][key as keyof typeof forecast[0]],n);
 const recurringRows=a.recurring.months.map((month:string)=>({merchant:a.recurring.merchant,month,ars:100,usd:null,installment_count:null}));
 const r=detectRecurring(recurringRows,{cpi:Object.fromEntries(a.recurring.months.map((m:string)=>[m,100]))})[0];equal("recurring-high-confidence",{confidence:r.confidence,status:r.status,currency:r.currency,lastAmount:r.lastAmount},a.recurring.expected);equal("recurring-three-months-insufficient",detectRecurring(recurringRows.slice(0,3)).length,0);equal("recurring-lapsed-relative-to-data",detectRecurring(recurringRows,{latestMonth:a.recurring.lapsedLatestMonth})[0].status,a.recurring.lapsedStatus);
 const supermarket=json("supermarket.json"),model=buildAnalytics(supermarket.receipts,supermarket.items);
 for(const key of ["lastTotalCents","prevTotalCents","avgTotalCents","monthlyProjectionCents","accumulatedTotalCents","accumulatedSavingsCents"])close(`supermarket-${key}`,(model.kpis as any)[key],supermarket.expected[key]);
 close("supermarket-list-index",model.index[1].list,supermarket.expected.listIndex);close("supermarket-effective-index",model.index[1].effective,supermarket.expected.effectiveIndex);equal("supermarket-frequency",model.frequency.essentials.length,2);close("rice-net-change",model.products.find(p=>p.productId===1)!.lastChange!.netPct,25);
 close("rice-gross-change",model.products.find(p=>p.productId===1)!.lastChange!.grossPct,supermarket.expected.riceGrossChangePct);close("soap-net-change",model.products.find(p=>p.productId===2)!.lastChange!.netPct,supermarket.expected.soapNetChangePct);
 const raw=supermarket.items.map((i:any)=>({...i,sourceLineId:`${i.receiptId}:${i.productId}`})),unreviewed=buildAnalytics(supermarket.receipts,[],raw);equal("raw-savings-without-reviewed-products",unreviewed.kpis?.accumulatedSavingsCents,4500);equal("no-unreviewed-price-products",unreviewed.products,[]);
 const identities=json("identity-vectors.json"),source=json("visa.expected.json");equal("source-digest-vector",sourcePayloadDigest(source),identities.sourcePayloadDigest.sha256);equal("source-digest-rename",sourcePayloadDigest({...source,file:"other.pdf"}),identities.sourcePayloadDigest.sha256);equal("fingerprint-key",chargeKey(identities.fingerprints.input),identities.fingerprints.key);equal("fingerprint-first",chargeFingerprint(identities.fingerprints.input,1),identities.fingerprints.first);equal("fingerprint-second",chargeFingerprint(identities.fingerprints.input,2),identities.fingerprints.second);
 equal("statement-source-key",sourceKey({cardId:card,kind:"statement",documentHash:"a".repeat(64),fiscalId:null,closingDate:"2026-02-01"}),identities.sourceKey.statement);
 for(const amount of [1.005,12.3400000001]){assert.throws(()=>sourceAmountMinor(amount),{code:e.errors.unsafeAmount});checks.push(`fractional-cent-${amount}-refused`);}
 equal("catalog-account-snapshot",baseCatalog(),json("catalog.json").accounts);equal("catalog-group-snapshot",purposeGroups(),json("catalog.json").groups);equal("route-control-snapshot",JSON.parse(JSON.stringify(CHROME)),json("routes.json"));equal("32-route-contracts",Object.keys(CHROME).length,32);
 equal("invalid-mode-defaults",parseModes({spend:"invalid",value:"invalid",tax:"invalid"}),{spend:"accrual",value:"real",tax:"excl"});equal("invalid-granularity-default",parseGranularity({g:"invalid"}),"month");equal("invalid-period-latest",resolvePeriod(["2026-01","2026-02"],"2026-Q1","latest"),"2026-02");equal("merchant-period-default",resolvePeriod(["2026-01"],undefined,"all-first"),"all");equal("merchant-wire-sanitization",wireName("SYNTHETIC SHOP 990000123456"),"SYNTHETIC SHOP");equal("merchant-money-rejected",wireName("SU PAGO 1.000,00"),null);
 const p=memory();await saveAccountName(p,{key:"name",accountId:"expense:unallocated",customName:"Shared custom name",recordedAt:date});const account=(await p.transaction(tx=>tx.account("expense:unallocated")))!;equal("literal-custom-name-both-locales",[resolveLabel(account,"en"),resolveLabel(account,"es")],["Shared custom name","Shared custom name"]);
 await saveGroup(p,{key:"group",id:"synthetic-overlap",customName:"Overlapping group",labelKey:null,accountIds:["expense:food","expense:food:groceries:pantry",`card:${card}`],additive:false,recordedAt:date});equal("cross-type-custom-group",(await p.transaction(tx=>tx.catalogGroups()))[0].accountIds.length,3);
 const snapshot=reportSnapshot(json("report-input.json"),json("supermarket.json"));let numericLeaves=0;const finite=(value:unknown):void=>{if(typeof value==="number"){assert.ok(Number.isFinite(value));numericLeaves++;}else if(Array.isArray(value))value.forEach(finite);else if(value&&typeof value==="object")Object.values(value).forEach(finite);};finite(snapshot);checks.push(`report-finite-numeric-leaves-${numericLeaves}`);equal("all-report-projections-golden",JSON.parse(JSON.stringify(snapshot)),json("reports.expected.json"));
 equal("chart-theme-snapshot",CHART_THEMES,json("chart-colors.json"));
 const formatting=json("formatting.json");for(const [i,row]of formatting.money.entries())equal(`chart-format-${i}`,fmtMoney(row.input,row.value),row.expected);for(const [i,row]of formatting.cents.entries())equal(`cent-format-${i}`,fmtMoneyCents(row.input,row.value),row.expected);for(const [i,row]of formatting.percent.entries())equal(`percent-format-${i}`,fmtPct(row.input),row.expected);
}
async function additionalJourneys(){
 const source=json("visa.expected.json"),pdf=fs.readFileSync(path.join(files,"pdf",source.file));
 const statement=async(p:LedgerPort,docs:ReturnType<typeof createMemoryDocuments>,s:any,key:string,bytes=pdf,cardId=card)=>importStatement(p,docs,{key,cardId,filename:s.file,pdf:bytes,json:s,rawJson:Buffer.from(JSON.stringify(s)),recordedAt:date,appRevision:"synthetic:rebuild-v1"});
 // Same-brand card isolation, and the stronger same-document identity guard.
 const p=memory(),docs=createMemoryDocuments();await statement(p,docs,source,"a");
 await assert.rejects(()=>statement(p,docs,source,"same-bytes",pdf,"synthetic-visa-b"),{code:"document_identity_conflict"});checks.push("same-pdf-cannot-change-card");
 await statement(p,docs,source,"b",Buffer.concat([pdf,Buffer.from("\n% distinct synthetic card document\n")]),"synthetic-visa-b");equal("same-brand-card-isolation",(await p.journals("synthetic-visa-b")).length,4);equal("first-card-unchanged",(await p.journals(card)).length,4);
 await assert.rejects(()=>statement(memory(),createMemoryDocuments(),source,"unknown",pdf,"visa"),{code:"unknown_card"});checks.push("brand-is-not-card-id");
 // Statement first converges with receipt later; unknown card is not guessed.
 const q=memory(),qd=createMemoryDocuments(),s=structuredClone(source);s.transactions=[{...s.transactions[0],description:"COTO",ars:130,usd:null}];s.declared_totals=[];
 const first=await statement(q,qd,s,"statement-first"),rows=text("receipt-valid.rows.txt"),parsed=parseRows(parseRowsText(rows));
 const receipt=await importReceipt(q,qd,{key:"receipt-later",bytes:fs.readFileSync(path.join(files,"pdf/synthetic_coto.pdf")),extraction:{parsed,rowsText:rows,report:verify(parsed),scale:3},correctedRowsText:null,recordedAt:date,appRevision:"synthetic:rebuild-v1"});
 equal("statement-first-receipt-same-identity",receipt.purchaseIds,first.purchaseIds);equal("statement-first-no-second-expense",(await totals(q)).expenseMinor,13000);
 const matches=await q.transaction(tx=>tx.reviewSubjects("match"));const originalMatch=matches[0] as any;
 await applyReview(q,{key:"approve-product",subjectId:originalMatch.productId,kind:"product_update",payload:{name:"Synthetic Rice",category:"pantry",unit:"un"},recordedAt:date});
 await reviewReceiptItem(q,{key:"approve-match",receiptRevisionId:receipt.sourceRevisionId,sourceLineId:originalMatch.id,productId:originalMatch.productId,recordedAt:date});
 const target=await q.transaction(tx=>createProductTx(tx,{name:"Synthetic Replacement",category:"pantry",unit:"un",reviewed:true}));
 const codeId=JSON.stringify(["coto","0000000001"]);
 await applyReview(q,{key:"move-code",subjectId:codeId,kind:"move_code",payload:{targetId:target},recordedAt:date});
 equal("moved-code-ownership",(await q.transaction(tx=>tx.reviewSubject("code",codeId)) as any).productId,target);equal("moved-code-invalidates-item",(await q.transaction(tx=>tx.reviewSubject("match",originalMatch.id)) as any).reviewed,false);
 await applyReview(q,{key:"merge-product",subjectId:originalMatch.productId,kind:"product_merge",payload:{targetId:target},recordedAt:date});equal("product-merge-redirect",(await q.transaction(tx=>tx.reviewSubject("product",originalMatch.productId)) as any).redirectId,target);equal("product-operations-preserve-principal",(await totals(q)).expenseMinor,13000);
 // A pre-opening receipt association is evidence only, with a link/unlink chain.
 const h=memory(),hd=createMemoryDocuments();
 await postJournal(h,{id:"historical-opening",commandKey:"historical-opening",cardId:card,currency:"ARS",effectiveDate:"2026-02-01",recordedAt:date,kind:"opening",reversesId:null,evidenceIds:evidence,lines:[{accountId:"equity:opening",debitMinor:13000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:`${card}:ARS:billed`,debitMinor:0,creditMinor:13000,purchaseId:null,purposeId:null}]},"synthetic-historical-opening");
 const hs=await statement(h,hd,s,"historical-source");
 const hr=await importReceipt(h,hd,{key:"historical-receipt",bytes:fs.readFileSync(path.join(files,"pdf/synthetic_coto.pdf")),extraction:{parsed,rowsText:rows,report:verify(parsed),scale:3},correctedRowsText:null,recordedAt:date,appRevision:"synthetic:rebuild-v1"});
 const link=await recordHistoricalAssociation(h,{key:"historical-link",receiptRevisionId:hr.sourceRevisionId,sourceLineId:sourceLineId(hs.sourceRevisionId,1),action:"link",expectedPreviousDecisionId:null,method:"manual",recordedAt:date});
 const unlink=await recordHistoricalAssociation(h,{key:"historical-unlink",receiptRevisionId:hr.sourceRevisionId,sourceLineId:null,action:"unlink",expectedPreviousDecisionId:link.id,method:"manual",recordedAt:date});equal("historical-link-unlink-chain",unlink.previousDecisionId,link.id);equal("historical-association-no-new-posting",(await h.journals(card)).length,1);
 // Full historical refund uses retained acquisition evidence, never another purchase.
 const refund=structuredClone(s);refund.period={closing_date:"2026-04-01"};refund.transactions=[{...s.transactions[0],section:"payments",date:"2026-03-05",description:"Reembolso SYNTHETIC COTO",ars:-130}];
 const retained=await statement(h,hd,refund,"historical-refund-source",Buffer.concat([pdf,Buffer.from("\n% synthetic refund statement\n")]));
 const input={key:"historical-full",cardId:card,currency:"ARS" as const,originalSourceLineId:sourceLineId(hs.sourceRevisionId,1),refundSourceLineId:sourceLineId(retained.sourceRevisionId,1),accountId:"expense:food:groceries:pantry",purposeId:"food",confirmedFullRefund:true,recordedAt:"2026-04-02T12:00:00Z"};
 equal("historical-full-refund-posted",(await postHistoricalRefund(h,input)).status,"posted");equal("historical-full-refund-native-balance",await totals(h),{expenseMinor:-13000,billedMinor:0,unbilledMinor:0,clearingMinor:0});equal("historical-full-refund-no-purchase",(await h.journals(card)).filter(j=>j.kind==="purchase").length,0);equal("historical-full-refund-replay",(await postHistoricalRefund(h,input)).status,"duplicate");equal("historical-full-refund-two-journals",(await h.journals(card)).length,2);
}
async function main(){await imports();await ledger();await receipts();await opening();await algorithms();await additionalJourneys();console.log(JSON.stringify({passed:checks.length,checks},null,2));}
main().catch(error=>{console.error(error);process.exitCode=1;});
