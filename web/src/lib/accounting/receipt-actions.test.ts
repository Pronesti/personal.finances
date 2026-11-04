import { beforeEach, expect, it, vi } from "vitest";
import type { AccountingContext } from "@/lib/backend";
import { createMemoryLedger } from "./memory";
import { createMemoryReader } from "./read-model";
import { createMemoryDocuments } from "./documents";
import { baseCatalog, cardAccounts } from "./catalog";
import { receiptExtraction } from "./receipt-test-support";
import { importReceipt } from "./receipt-import";
import { importStatement } from "./statement-import";
import { sourceLineId } from "./evidence";
const state=vi.hoisted(()=>({context:null as unknown as AccountingContext,sqlite:vi.fn()}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",withAccounting:async<T>(work:(context:AccountingContext)=>Promise<T>)=>work(state.context)}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/db",async original=>({...await original<object>(),getDb:state.sqlite}));
import { saveProductAction, moveCodeAction, rematchAllAction } from "@/app/super/review/actions";
import { linkChargeAction, unlinkChargeAction } from "@/app/super/charges/actions";
import { recordReceiptPurchaseAction,reviewReceiptProductAction,allocateReceiptItemsAction } from "@/app/receipts/accounting-actions";
import { classifyAccountingPurchaseAction } from "@/app/review/accounting-actions";
beforeEach(()=>{
 vi.clearAllMocks();state.sqlite.mockImplementation(()=>{throw new Error("unexpected SQLite");});
 const ledger=Object.assign(createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","A")],cardIds:["card-a"]}),{close:async()=>{}});
 state.context={ledger,reader:createMemoryReader(),documents:createMemoryDocuments(),documentRoot:"/unused",appRevision:"synthetic:test"};
});
const form=(fields:Record<string,string>)=>{const f=new FormData();Object.entries(fields).forEach(([k,v])=>f.set(k,v));return f;};
async function receipt(){return importReceipt(state.context.ledger,state.context.documents,{key:"r1",bytes:Buffer.from("%PDF-action-receipt"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"});}
it("routes canonical product approval and reviewed allocation through the actual PostgreSQL services",async()=>{
 const r=await receipt(),id=sourceLineId(r.sourceRevisionId,1),match=await state.context.ledger.transaction(tx=>tx.reviewSubject("match",id));if(match?.kind!=="match")throw new Error("missing synthetic match");
 await saveProductAction(form({id:match.productId,name:"Known synthetic item",category:"other",unit:"un"}));
 expect(await state.context.ledger.transaction(tx=>tx.reviewSubject("match",id))).toMatchObject({reviewed:false});
 await reviewReceiptProductAction(form({receiptRevisionId:r.sourceRevisionId,sourceLineId:id,productId:match.productId}));
 await recordReceiptPurchaseAction(form({receiptRevisionId:r.sourceRevisionId,cardId:"card-a",paymentVerified:"on"}));
 const allocationForm=form({receiptRevisionId:r.sourceRevisionId,[`account:${encodeURIComponent(id)}`]:"expense:food:groceries:pantry"});
 const submitted=await new Request("http://localhost/receipts/1",{method:"POST",body:allocationForm}).formData();
 await allocateReceiptItemsAction(submitted);
 const p=await state.context.ledger.transaction(tx=>tx.purchase("receipt-purchase:1"));expect(p?.version).toBe(2);expect(p?.allocations).toEqual([{accountId:"expense:food:groceries:pantry",purposeId:"food",minor:8000}]);expect(state.sqlite).not.toHaveBeenCalled();
});
it("accepts actual purchase identities for link/unlink rather than requiring legacy SHA1 fingerprints",async()=>{
 const json={file:"s.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",date:"2026-01-15",description:"MERPAGO*COTO",ars:80,usd:null,installment_number:null,installment_count:null}]};
 const s=await importStatement(state.context.ledger,state.context.documents,{key:"s",cardId:"card-a",filename:"s.pdf",pdf:Buffer.from("%PDF-action-statement"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-01T00:00:00Z",appRevision:"synthetic:test"});
 await receipt();await unlinkChargeAction(form({receipt:"1"}));await linkChargeAction(form({receipt:"1",fingerprint:s.purchaseIds[0]}));
 expect((await state.context.ledger.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);expect(state.sqlite).not.toHaveBeenCalled();
});
it("refuses history changes without explicit preview confirmation before any mutation",async()=>{
 await expect(classifyAccountingPurchaseAction(form({scope:"matching_history",purchaseId:"unknown",cardId:"card-a",accountId:"expense:food:groceries:pantry",match:"COTO"}))).rejects.toThrow("history_confirmation_required");expect(await state.context.ledger.journals("card-a")).toEqual([]);expect(state.sqlite).not.toHaveBeenCalled();
});

it("moves an article code and rematches source items without inventing reviewed product identity",async()=>{
 const r=await receipt(),lineId=sourceLineId(r.sourceRevisionId,1),target=await state.context.ledger.transaction(async tx=>{const id=await tx.nextProductId();await tx.appendReviewSubject({kind:"product",id,name:"Target identity",category:"other",unit:"un",reviewed:true,redirectId:null});return id;});
 await moveCodeAction(form({sku:"0000000001",target}));await rematchAllAction();
 expect(await state.context.ledger.transaction(tx=>tx.reviewSubject("code",JSON.stringify(["coto","0000000001"])))).toMatchObject({productId:target});
 expect(await state.context.ledger.transaction(tx=>tx.reviewSubject("match",lineId))).toMatchObject({productId:target,reviewed:false,method:"code"});
 expect(state.sqlite).not.toHaveBeenCalled();
});
it("links and unlinks historical receipt evidence by actual source identity with zero financial changes",async()=>{
 const {postJournal}=await import("./use-cases"),{accountingReconciliation}=await import("./receipt-ui"),{latestHistoricalAssociation}=await import("./historical-links");
 // A real accepted source establishes opening evidence; the later historical statement is not backfilled into books.
 const json={file:"opening.pdf",brand:"visa",period:{closing_date:"2026-02-01"},transactions:[]};
 const openingSource=await importStatement(state.context.ledger,state.context.documents,{key:"opening-source",cardId:"card-a",filename:"opening.pdf",pdf:Buffer.from("%PDF-opening-source"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-02T00:00:00Z",appRevision:"synthetic:test"});
 await postJournal(state.context.ledger,{id:"opening",commandKey:"opening",cardId:"card-a",currency:"ARS",kind:"opening",effectiveDate:"2026-02-01",recordedAt:"2026-02-02T00:00:00Z",reversesId:null,evidenceIds:[openingSource.sourceRevisionId],lines:[{accountId:"equity:opening",purchaseId:null,purposeId:null,debitMinor:8000,creditMinor:0},{accountId:"card-a:ARS:billed",purchaseId:null,purposeId:null,debitMinor:0,creditMinor:8000}]},"opening");
 const old={file:"historical.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"MERPAGO*COTO",ars:80,usd:null,installment_number:null,installment_count:null}]};
 const source=await importStatement(state.context.ledger,state.context.documents,{key:"historical",cardId:"card-a",filename:"historical.pdf",pdf:Buffer.from("%PDF-historical-statement"),json:old,rawJson:Buffer.from(JSON.stringify(old)),recordedAt:"2026-02-03T00:00:00Z",appRevision:"synthetic:test"});
 const r=await receipt(),lineId=sourceLineId(source.sourceRevisionId,1),before=await state.context.ledger.journals("card-a");
 expect((await accountingReconciliation(state.context.ledger)).receipts[0].candidates[0].fingerprint).toBe(`historical-source:${lineId}`);
 await linkChargeAction(form({receipt:"1",fingerprint:`historical-source:${lineId}`,historicalPreviousDecisionId:""}));
 const matched=await accountingReconciliation(state.context.ledger);expect(matched.receipts[0]).toMatchObject({state:"matched",historical:true});expect(matched.charges[0].receiptId).toBe(1);
 const association=await state.context.ledger.transaction(async tx=>latestHistoricalAssociation(await tx.historicalAssociations(r.sourceRevisionId)));
 await expect(unlinkChargeAction(form({receipt:"1",historical:"yes",historicalPreviousDecisionId:"stale"}))).rejects.toThrow("stale_historical_association");
 await unlinkChargeAction(form({receipt:"1",historical:"yes",historicalPreviousDecisionId:association!.id}));
 expect((await accountingReconciliation(state.context.ledger)).receipts[0]).toMatchObject({state:"unmatched",historical:false});expect(await state.context.ledger.journals("card-a")).toEqual(before);expect(await state.context.ledger.transaction(tx=>tx.receiptLinkDecisions(r.sourceRevisionId))).toEqual([]);expect(await state.context.ledger.transaction(tx=>tx.historicalAssociations(r.sourceRevisionId))).toHaveLength(2);expect(state.sqlite).not.toHaveBeenCalled();
});
