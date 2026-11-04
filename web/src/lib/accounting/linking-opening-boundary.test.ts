import {describe,it,expect} from "vitest";
import {createMemoryLedger} from "./memory";
import {syntheticSeed,purchaseInput,balancedJournal,totals,withTestLedger} from "./test-support";
import {historicalLinkFixture} from "./historical-links-test-support";
import {recordHistoricalAssociation} from "./historical-links";
import {reconcileReceipt} from "./linking";
import {recordPurchase,postJournal} from "./use-cases";
import {importStatement} from "./statement-import";
import {createMemoryDocuments} from "./documents";
import type {LedgerPort} from "./port";
const now="2026-02-02T12:00:00Z";
async function financialTarget(port:LedgerPort,sourceLineId:string){await recordPurchase(port,purchaseInput({principalMinor:8000,allocations:[{accountId:"expense:unallocated",purposeId:"unallocated",minor:8000}]}));await port.transaction(tx=>tx.appendPurchaseIdentity({purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",purchaseDate:"2026-01-15",voucher:null,installment:1,installmentCount:2,amountMinor:4000,sourceLineId}));}
async function otherSource(port:LedgerPort){const json={file:"other-source.pdf",brand:"visa",period:{closing_date:"2026-02-28"},transactions:[{section:"purchases",date:"2026-01-15",description:"COTO SYNTHETIC",ars:40,usd:null,installment_number:1,installment_count:2}]};const result=await importStatement(port,createMemoryDocuments(),{key:"other-source",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-other-source"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:now,appRevision:"synthetic",observationOnly:true});return (await port.transaction(tx=>tx.sourceLines(result.sourceRevisionId)))[0].id;}
async function reconcile(port:LedgerPort,receiptRevisionId:string,purchaseId:string|null="purchase-a"){return reconcileReceipt(port,{key:"financial-proof",receiptRevisionId,purchaseId,cardId:"card-a",paymentVerified:true,allocation:null,recordedAt:now});}
async function snapshot(port:LedgerPort){return {journals:await port.journals("card-a"),totals:await totals(port,"card-a","ARS"),links:await port.transaction(tx=>tx.allReceiptLinkDecisions()),historical:await port.transaction(tx=>tx.historicalAssociations())};}
async function conflict(port:LedgerPort,kind:"different-purchase"|"other-receipt"){
 const fixture=await historicalLinkFixture(port);await recordHistoricalAssociation(port,fixture.input);
 await financialTarget(port,kind==="different-purchase"?await otherSource(port):fixture.line.id);
 const before=await snapshot(port),receiptId=fixture.receipts[kind==="different-purchase"?0:1].sourceRevisionId;
 const result=await reconcile(port,receiptId);expect(result.reviews.map(r=>r.code)).toContain(kind==="different-purchase"?"receipt_has_historical_association":"purchase_already_linked");expect(result.purchaseIds).toEqual([]);expect(result.postedJournalIds).toEqual([]);expect(await snapshot(port)).toEqual(before);
}
async function boundary(port:LedgerPort){const fixture=await historicalLinkFixture(port);await postJournal(port,balancedJournal({id:"opening",commandKey:"opening",kind:"opening",effectiveDate:"2026-01-31",lines:[{accountId:"equity:opening",debitMinor:8000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:"card-a:ARS:unbilled",debitMinor:0,creditMinor:8000,purchaseId:null,purposeId:null}]}),"opening-proof");const before=await snapshot(port);const result=await reconcile(port,fixture.receipts[0].sourceRevisionId,null);expect(result.reviews.map(r=>r.code)).toContain("historical_receipt_requires_opening_reconciliation");expect(result.postedJournalIds).toEqual([]);expect(result.purchaseIds).toEqual([]);expect(await snapshot(port)).toEqual(before);}
describe("receipt ownership and opening continuity",()=>{
it("does not recreate acquisition expense for a receipt before the opening cohort",()=>boundary(createMemoryLedger(syntheticSeed())));
it.each(["different-purchase","other-receipt"] as const)("refuses conflicting %s ownership without altering financial facts or associations",kind=>conflict(createMemoryLedger(syntheticSeed()),kind));
it("allows historical and financial associations for the same receipt and same source purchase",async()=>{const p=createMemoryLedger(syntheticSeed()),fixture=await historicalLinkFixture(p);await recordHistoricalAssociation(p,fixture.input);await financialTarget(p,fixture.line.id);const before=await p.journals("card-a"),history=await p.transaction(tx=>tx.historicalAssociations());const result=await reconcile(p,fixture.receipts[0].sourceRevisionId);expect(result.reviews).toEqual([]);expect(result.purchaseIds).toEqual(["purchase-a"]);expect(result.postedJournalIds).toEqual([]);expect(await p.journals("card-a")).toEqual(before);expect(await p.transaction(tx=>tx.historicalAssociations())).toEqual(history);expect((await p.transaction(tx=>tx.allReceiptLinkDecisions())).at(-1)?.purchaseId).toBe("purchase-a");});
});
describe.skipIf(process.env.ACCOUNTING_PG_TESTS!=="1")("PG receipt ownership and opening boundary",()=>{it("preserves opening financial facts",()=>withTestLedger(boundary));it.each(["different-purchase","other-receipt"] as const)("preserves conflicting %s ownership",kind=>withTestLedger(p=>conflict(p,kind)));});
