import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./documents";
import { baseCatalog, cardAccounts } from "./catalog";
import { importReceipt } from "./receipt-import";
import { receiptExtraction } from "./receipt-test-support";
import { importStatement } from "./statement-import";
import { reconcileReceipt, unlinkReceipt, latestReceiptDecision } from "./linking";
import { sourceLineId } from "./evidence";
import { createProductTx, reviewReceiptItem } from "./review";
const now="2026-02-01T12:00:00Z";
const ledger=()=>createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Synthetic card")],cardIds:["card-a"]});
async function receipt(port:ReturnType<typeof ledger>,docs:ReturnType<typeof createMemoryDocuments>,options:Parameters<typeof receiptExtraction>[0]={}) {
 return importReceipt(port,docs,{key:options?.fiscalNumber??"r1",bytes:Buffer.from(`%PDF-receipt-${options?.fiscalNumber??"a"}`),extraction:receiptExtraction(options),correctedRowsText:null,recordedAt:now,appRevision:"synthetic:test"});
}
async function statement(port:ReturnType<typeof ledger>,docs:ReturnType<typeof createMemoryDocuments>,amountMinor=8000,cardId="card-a") {
 const json={file:"synthetic_2026.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"MERPAGO*COTO",ars:amountMinor/100,usd:null,installment_number:null,installment_count:null}],declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:amountMinor/100,usd:null}]};
 return importStatement(port,docs,{key:`statement-${cardId}`,cardId,filename:json.file,pdf:Buffer.from(`%PDF-statement-${cardId}`),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:now,appRevision:"synthetic:test"});
}
const reconcile=(port:ReturnType<typeof ledger>,receiptRevisionId:string,overrides:Partial<Parameters<typeof reconcileReceipt>[1]>={})=>reconcileReceipt(port,{key:"proof",receiptRevisionId,cardId:"card-a",paymentVerified:true,purchaseId:null,allocation:null,recordedAt:now,...overrides});

describe("one economic purchase across receipt and statement arrivals",()=>{
  it.each(["receipt-first","statement-first"])("%s retains one acquisition and a separate billing",async order=>{
    const port=ledger(),docs=createMemoryDocuments();let receiptId:string;
    if(order==="receipt-first") {const r=await receipt(port,docs);receiptId=r.sourceRevisionId;await reconcile(port,receiptId);await statement(port,docs);}
    else {await statement(port,docs);receiptId=(await receipt(port,docs)).sourceRevisionId;}
    const journals=await port.journals("card-a");
    expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);expect(journals.filter(j=>j.kind==="billing")).toHaveLength(1);
    expect(journals.filter(j=>j.kind==="purchase").flatMap(j=>j.lines).reduce((s,l)=>s+l.debitMinor,0)).toBe(8000);
    await port.transaction(async tx=>expect(latestReceiptDecision(await tx.receiptLinkDecisions(receiptId))?.action).toBe("link"));
  });
  it.each(["receipt-first","statement-first"])("%s uses evidenced receipt principal across installment cycles without multiplying a bill",async order=>{
    const port=ledger(),docs=createMemoryDocuments();let r:Awaited<ReturnType<typeof receipt>>|undefined;
    if(order==="receipt-first") {r=await receipt(port,docs);await reconcile(port,r.sourceRevisionId);}
    for(const n of [1,2]) {
      const json={file:`synthetic_2026_${n}.pdf`,brand:"visa",period:{closing_date:n===1?"2026-01-31":"2026-02-28"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"MERPAGO*COTO",voucher:"same-voucher",ars:13.33,usd:null,installment_number:n,installment_count:6}]};
      const result=await importStatement(port,docs,{key:`installment-${n}`,cardId:"card-a",filename:json.file,pdf:Buffer.from(`%PDF-installment-${n}`),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:now,appRevision:"synthetic:test"});
      if(order==="statement-first") expect(result.postedJournalIds).toEqual([]);
    }
    if(order==="statement-first") {r=await receipt(port,docs);await reconcile(port,r.sourceRevisionId);}
    const journals=await port.journals("card-a");
    expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);expect(journals.filter(j=>j.kind==="billing")).toHaveLength(2);
    expect(journals.find(j=>j.kind==="purchase")?.lines[0].debitMinor).toBe(8000);
    expect(journals.filter(j=>j.kind==="billing").map(j=>j.lines[0].debitMinor)).toEqual([1333,1333]);
  });
  it("unlinking preserves debt and permits a later receipt import to auto-link again",async()=>{
    const port=ledger(),docs=createMemoryDocuments();await statement(port,docs);
    const r=await receipt(port,docs);await unlinkReceipt(port,{key:"unlink",receiptRevisionId:r.sourceRevisionId,recordedAt:now});
    const before=await port.journals("card-a");
    const again=await importReceipt(port,docs,{key:"again",bytes:Buffer.from("%PDF-receipt-a"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:now,appRevision:"synthetic:test"});
    expect(again.duplicate).toBe(true);expect(await port.journals("card-a")).toEqual(before);
    await port.transaction(async tx=>{const history=await tx.receiptLinkDecisions(r.sourceRevisionId);expect(history.map(d=>d.action)).toEqual(["link","unlink","link"]);});
  });
  it("unlinking a receipt-origin association never causes a second acquisition when its statement arrives",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),r=await receipt(port,docs);
    await reconcile(port,r.sourceRevisionId);await unlinkReceipt(port,{key:"unlink",receiptRevisionId:r.sourceRevisionId,recordedAt:now});await statement(port,docs);
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
  });
  it("keeps one-cent discrepancies, unknown payment and occupied candidates in review",async()=>{
    const port=ledger(),docs=createMemoryDocuments();await statement(port,docs,8001);const r=await receipt(port,docs);
    const mismatch=await reconcile(port,r.sourceRevisionId);expect(mismatch.reviews.map(r=>r.code)).toContain("receipt_amount_mismatch");
    expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
    const other=ledger(),d=createMemoryDocuments(),unpaid=await receipt(other,d,{paymentCents:7999});
    expect((await reconcile(other,unpaid.sourceRevisionId)).reviews.map(r=>r.code)).toContain("receipt_payment_unresolved");expect(await other.journals("card-a")).toEqual([]);
    const occupied=ledger(),od=createMemoryDocuments();await statement(occupied,od);await receipt(occupied,od);
    const second=await receipt(occupied,od,{fiscalNumber:"0001-00000002"});
    expect(second.reviews.map(r=>r.code)).toContain("purchase_already_linked");
    expect((await occupied.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
  });
  it("requires actual card evidence and leaves competing cards ambiguous",async()=>{
    const port=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","A"),...cardAccounts("card-b","B")],cardIds:["card-a","card-b"]}),docs=createMemoryDocuments();
    await statement(port,docs,8000,"card-a");await statement(port,docs,8000,"card-b");
    const r=await receipt(port,docs);
    expect(r.reviews.map(r=>r.code)).toContain("multiple_receipt_candidates");
    const linked=await reconcile(port,r.sourceRevisionId);expect(linked.purchaseIds).toHaveLength(1);
    const unknown=ledger(),ud=createMemoryDocuments(),ur=await receipt(unknown,ud);
    expect((await reconcile(unknown,ur.sourceRevisionId,{cardId:null})).reviews.map(r=>r.code)).toContain("receipt_payment_unresolved");expect(await unknown.journals("card-a")).toEqual([]);
  });
  it("allocates reviewed items only and retains the remainder in Unallocated",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),r=await receipt(port,docs,{itemNetAmounts:[7000,2000,1000]});
    const item=sourceLineId(r.sourceRevisionId,1);
    const productId=await port.transaction(tx=>createProductTx(tx,{name:"Reviewed synthetic product",category:"other",unit:"un",reviewed:true}));
    await reviewReceiptItem(port,{key:"item-1",receiptRevisionId:r.sourceRevisionId,sourceLineId:item,productId,recordedAt:now});
    await expect(reconcile(port,r.sourceRevisionId,{allocation:[{accountId:"expense:food:groceries:pantry",purposeId:"food",minor:10000}]})).rejects.toThrow("product_identity_unreviewed");
    expect(await port.journals("card-a")).toEqual([]);
    const result=await reconcile(port,r.sourceRevisionId,{key:"partial",itemAllocations:[{sourceLineId:item,accountId:"expense:food:groceries:pantry",purposeId:"food",minor:7000}]});
    expect(result.purchaseIds).toHaveLength(1);
    const purchase=await port.transaction(tx=>tx.purchase(result.purchaseIds[0]));
    expect(purchase?.allocations).toEqual([{accountId:"expense:food:groceries:pantry",purposeId:"food",minor:7000},{accountId:"expense:unallocated",purposeId:"unallocated",minor:3000}]);
    await port.transaction(async tx=>expect(latestReceiptDecision(await tx.receiptLinkDecisions(r.sourceRevisionId))?.itemAllocations).toHaveLength(1));
  });
  it("corrects a posted purchase allocation through reversal and replacement after per-item approval",async()=>{
    const port=ledger(),docs=createMemoryDocuments(),s=await statement(port,docs),r=await receipt(port,docs);
    const productId=await port.transaction(tx=>createProductTx(tx,{name:"Reviewed synthetic product",category:"other",unit:"un",reviewed:true}));
    await reviewReceiptItem(port,{key:"item",receiptRevisionId:r.sourceRevisionId,sourceLineId:sourceLineId(r.sourceRevisionId,1),productId,recordedAt:now});
    await reconcile(port,r.sourceRevisionId,{allocation:[{accountId:"expense:food:groceries:pantry",purposeId:"food",minor:8000}]});
    const p=await port.transaction(tx=>tx.purchase(s.purchaseIds[0]));expect(p?.version).toBe(2);
    const journals=await port.journals("card-a");expect(journals.filter(j=>j.kind==="purchase")).toHaveLength(1);expect(journals.filter(j=>j.kind==="reversal")).toHaveLength(1);expect(journals.filter(j=>j.kind==="replacement")).toHaveLength(1);
  });
});

it('preserves reviewed per-item allocations when later statement reconciliation supplies no new allocation',async()=>{
 const port=ledger(),docs=createMemoryDocuments(),r=await receipt(port,docs,{itemNetAmounts:[7000,3000]});
 const product=await port.transaction(tx=>createProductTx(tx,{name:'Known pantry item',category:'pantry',unit:'un',reviewed:true}));
 const id=sourceLineId(r.sourceRevisionId,1);
 await reviewReceiptItem(port,{key:'known-item',receiptRevisionId:r.sourceRevisionId,sourceLineId:id,productId:product,recordedAt:now});
 const itemAllocations=[{sourceLineId:id,accountId:'expense:food:groceries:pantry',purposeId:'food',minor:7000}];
 await reconcile(port,r.sourceRevisionId,{itemAllocations});await statement(port,docs,10000);
 const latest=await port.transaction(async tx=>latestReceiptDecision(await tx.receiptLinkDecisions(r.sourceRevisionId)));
 expect(latest?.itemAllocations).toEqual(itemAllocations);
 expect((await port.journals('card-a')).filter(j=>j.kind==='purchase')).toHaveLength(1);
});

it('does not reopen an already reviewed historical receipt when a later statement arrives',async()=>{
 const {postJournal}=await import('./use-cases'),{recordHistoricalAssociation}=await import('./historical-links'),{applyReview}=await import('./review');
 const port=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts('card-a','Synthetic card')],cardIds:['card-a'],evidenceIds:['synthetic:e1']}),docs=createMemoryDocuments();
 await postJournal(port,{id:'opening',commandKey:'opening',cardId:'card-a',currency:'ARS',effectiveDate:'2026-02-01',recordedAt:now,kind:'opening',reversesId:null,evidenceIds:['synthetic:e1'],lines:[{accountId:'equity:opening',debitMinor:8000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:'card-a:ARS:billed',debitMinor:0,creditMinor:8000,purchaseId:null,purposeId:null}]},'opening-historical-test');
 const old=await statement(port,docs),r=await receipt(port,docs);
 await recordHistoricalAssociation(port,{key:'old-link',receiptRevisionId:r.sourceRevisionId,sourceLineId:sourceLineId(old.sourceRevisionId,1),action:'link',expectedPreviousDecisionId:null,method:'manual',recordedAt:now});
 await applyReview(port,{key:'resolved-old-receipt',subjectId:r.sourceRevisionId,kind:'alert_state',payload:{state:'reviewed'},recordedAt:now});
 const before=await port.transaction(tx=>tx.reviewEvents(r.sourceRevisionId));
 const json={file:'synthetic-next.pdf',brand:'visa',period:{closing_date:'2026-02-28'},transactions:[],declared_totals:[]};
 await importStatement(port,docs,{key:'next-statement',cardId:'card-a',filename:json.file,pdf:Buffer.from('%PDF-next-historical'),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:now,appRevision:'synthetic:test'});
 expect(await port.transaction(tx=>tx.reviewEvents(r.sourceRevisionId))).toEqual(before);
});
