import {expect,it} from "vitest";
import {createMemoryLedger} from "./memory";
import {baseCatalog,cardAccounts} from "./catalog";
import {createMemoryDocuments} from "./documents";
import {importStatement} from "./statement-import";
import {postJournal} from "./use-cases";
import {applyReview} from "./review";
import {HISTORICAL_CLASSIFICATION_CODE,previewSourceClassificationTx} from "./source-classification";
async function fixture(financed=false){
 const ledger=createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Actual card")],cardIds:["card-a"],evidenceIds:["opening-proof"]});
 await postJournal(ledger,{id:"opening",commandKey:"opening",cardId:"card-a",currency:"ARS",effectiveDate:"2026-02-01",recordedAt:"2026-02-02T00:00:00Z",kind:"opening",reversesId:null,evidenceIds:["opening-proof"],lines:[{accountId:"equity:opening",purchaseId:null,purposeId:null,debitMinor:20000,creditMinor:0},{accountId:"card-a:ARS:billed",purchaseId:null,purposeId:null,debitMinor:0,creditMinor:20000}]},"opening");
 const json={file:"historical.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"SAME SHOP",ars:financed?40:100,usd:null,installment_number:financed?1:null,installment_count:financed?2:null},{section:"purchases",block:1,date:"2026-01-16",description:"SAME SHOP EXTRA",ars:100,usd:null,installment_number:null,installment_count:null}]};
 const imported=await importStatement(ledger,createMemoryDocuments(),{key:"source",cardId:"card-a",filename:"historical.pdf",pdf:Buffer.from("%PDF-historical-classification"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-03T00:00:00Z",appRevision:"synthetic:test"});
 return {ledger,lines:await ledger.transaction(tx=>tx.sourceLines(imported.sourceRevisionId))};
}
const command=(sourceLineId:string,over:Record<string,unknown>={})=>({key:"selected",subjectId:sourceLineId,kind:"source_classification" as const,payload:{scope:"selected",accountId:"expense:home:cleaning",purposeId:"home",...over},recordedAt:"2026-03-01T12:00:00Z"});
it("classifies one historical source by default with an independent append-only review chain and zero book changes",async()=>{
 const {ledger,lines}=await fixture(),before=await ledger.journals("card-a"),original=structuredClone(lines);
 await ledger.transaction(tx=>tx.appendReviewEvent({id:"unrelated",subjectId:lines[0].id,code:"unrelated_identity_review",params:{},sourceLineIds:[lines[0].id],priorDecisionId:null,state:"reviewed",recordedAt:"2026-02-28T00:00:00Z"}));
 await applyReview(ledger,command(lines[0].id));await applyReview(ledger,command(lines[0].id));
 await applyReview(ledger,{...command(lines[0].id),key:"selected-again",payload:{scope:"selected",accountId:"expense:food:groceries:pantry",purposeId:"food"},recordedAt:"2026-03-02T12:00:00Z"});
 const events=await ledger.transaction(tx=>tx.reviewEvents(lines[0].id)),classification=events.filter(event=>event.code===HISTORICAL_CLASSIFICATION_CODE);
 expect(classification).toHaveLength(2);expect(classification[0].priorDecisionId).toBeNull();expect(classification[1].priorDecisionId).toBe(classification[0].id);expect(classification[0].recordedAt).toBe("2026-03-01T12:00:00Z");expect(await ledger.transaction(tx=>tx.reviewEvents(lines[1].id))).toEqual([]);expect(await ledger.journals("card-a")).toEqual(before);expect(await ledger.transaction(tx=>tx.sourceLines(lines[0].revisionId))).toEqual(original);
});
it("saves future rules without historical events and requires exact explicit source-history confirmation",async()=>{
 const {ledger,lines}=await fixture(),before=await ledger.journals("card-a");
 const preview=await ledger.transaction(tx=>previewSourceClassificationTx(tx,{sourceLineId:lines[0].id,match:"SAME SHOP"}));expect(preview).toHaveLength(2);
 await applyReview(ledger,command(lines[0].id,{scope:"future_rule",match:"SAME SHOP"}));expect(await ledger.transaction(tx=>tx.reviewEvents(lines[0].id))).toEqual([]);
 await expect(applyReview(ledger,{...command(lines[0].id,{scope:"matching_history",match:"SAME SHOP",confirmedSourceLineIds:[lines[0].id]}),key:"history"})).rejects.toThrow("history_confirmation_required");
 await applyReview(ledger,{...command(lines[0].id,{scope:"matching_history",match:"SAME SHOP",confirmHistory:true,confirmedSourceLineIds:preview.map(row=>row.sourceLineId)}),key:"history"});
 for(const line of lines)expect(await ledger.transaction(tx=>tx.reviewEvents(line.id))).toMatchObject([{code:HISTORICAL_CLASSIFICATION_CODE,params:{accountId:"expense:home:cleaning",scope:"matching_history"}}]);expect(await ledger.journals("card-a")).toEqual(before);
});
it("rejects non-leaf targets and nonexistent evidence without partial revisions",async()=>{
 const {ledger,lines}=await fixture();await expect(applyReview(ledger,command(lines[0].id,{accountId:"expense:food",purposeId:"food"}))).rejects.toThrow("invalid_posting_account");await expect(applyReview(ledger,command("missing"))).rejects.toThrow("missing_historical_acquisition");expect(await ledger.transaction(tx=>tx.reviewEvents(lines[0].id))).toEqual([]);expect(await ledger.transaction(tx=>tx.reviewDecisions(lines[0].id))).toEqual([]);
});
it.skipIf(process.env.ACCOUNTING_PG_TESTS!=="1")("persists source-only classification through PostgreSQL and the actual reader without changing opening books",async()=>{
 const {withTestLedger}=await import("./test-support"),{seedActualCatalogCards}=await import("./catalog-service"),{createPostgresReader}=await import("./reader-postgres");
 await withTestLedger(async(ledger,context)=>{
  await seedActualCatalogCards(ledger,[{id:"card-a",displayName:"Actual card"}]);const documents=createMemoryDocuments();
  const evidence={file:"opening.pdf",brand:"visa",period:{closing_date:"2026-02-01"},transactions:[]};const proof=await importStatement(ledger,documents,{key:"opening-source",cardId:"card-a",filename:"opening.pdf",pdf:Buffer.from("%PDF-opening-proof"),json:evidence,rawJson:Buffer.from(JSON.stringify(evidence)),recordedAt:"2026-02-02T00:00:00Z",appRevision:"synthetic:test"});
  await postJournal(ledger,{id:"opening",commandKey:"opening",cardId:"card-a",currency:"ARS",effectiveDate:"2026-02-01",recordedAt:"2026-02-02T00:00:00Z",kind:"opening",reversesId:null,evidenceIds:[proof.sourceRevisionId],lines:[{accountId:"equity:opening",purchaseId:null,purposeId:null,debitMinor:10000,creditMinor:0},{accountId:"card-a:ARS:billed",purchaseId:null,purposeId:null,debitMinor:0,creditMinor:10000}]},"opening");
  const json={file:"historical.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"SAME SHOP",ars:100,usd:null,installment_number:null,installment_count:null}]},imported=await importStatement(ledger,documents,{key:"historical",cardId:"card-a",filename:"historical.pdf",pdf:Buffer.from("%PDF-historical-source"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-03T00:00:00Z",appRevision:"synthetic:test"}),line=(await ledger.transaction(tx=>tx.sourceLines(imported.sourceRevisionId)))[0],before=await ledger.journals("card-a");
  await applyReview(ledger,command(line.id));const reader=createPostgresReader(context.connectionString,context.schema);try{expect((await reader.facts()).find(fact=>fact.origin==="historical_acquisition"&&fact.sourceLineId===line.id)).toMatchObject({accountId:"expense:home:cleaning",purposeId:"home",minor:10000,purchaseId:null});}finally{await reader.close();}
  expect(await ledger.journals("card-a")).toEqual(before);expect((await ledger.transaction(tx=>tx.reviewDecisions(line.id)))[0].kind).toBe("source_classification");
 },{seed:false});
});

it("classifies financed historical evidence only when a current verified full receipt supports its principal",async()=>{
 const {ledger,lines}=await fixture(true),before=await ledger.journals("card-a"),original=structuredClone(lines);
 await expect(applyReview(ledger,command(lines[0].id))).rejects.toThrow("missing_historical_acquisition");
 const {importReceipt}=await import("./receipt-import"),{receiptExtraction}=await import("./receipt-test-support"),{recordHistoricalAssociation}=await import("./historical-links");
 const receipt=await importReceipt(ledger,createMemoryDocuments(),{key:"full-receipt",bytes:Buffer.from("%PDF-full-principal"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-02-03T00:00:00Z",appRevision:"synthetic:test"});
 await recordHistoricalAssociation(ledger,{key:"associate",receiptRevisionId:receipt.sourceRevisionId,sourceLineId:lines[0].id,action:"link",expectedPreviousDecisionId:null,method:"manual",recordedAt:"2026-02-03T00:00:00Z"});
 await applyReview(ledger,command(lines[0].id));expect(await ledger.transaction(tx=>tx.reviewEvents(lines[0].id))).toMatchObject([{code:HISTORICAL_CLASSIFICATION_CODE,params:{accountId:"expense:home:cleaning"}}]);expect(await ledger.journals("card-a")).toEqual(before);expect(await ledger.transaction(tx=>tx.sourceLines(lines[0].revisionId))).toEqual(original);
});
