import {expect,it} from "vitest";
import {createMemoryLedger} from "./memory";
import {createMemoryDocuments} from "./documents";
import {syntheticSeed} from "./test-support";
import {receiptExtraction} from "./receipt-test-support";
import {importReceipt,type ReceiptImportInput} from "./receipt-import";
import {createProductTx,reviewReceiptItem} from "./review";
const input=(legacyProductMatches:ReceiptImportInput["legacyProductMatches"]):ReceiptImportInput=>({key:"legacy",bytes:Buffer.from("%PDF-test"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"test",legacyProductMatches});
it("preserves original product identity without creating replacement auto products or approving purchase allocation",async()=>{
 const port=createMemoryLedger(syntheticSeed()),docs=createMemoryDocuments();
 const productId=await port.transaction(tx=>createProductTx(tx,{name:"Original custom name",category:"pantry",unit:"un",reviewed:true}));
 const result=await importReceipt(port,docs,input([{occurrence:1,productId,method:"manual",reviewed:false}]));
 await port.transaction(async tx=>{expect(await tx.reviewSubjects("product")).toHaveLength(1);expect(await tx.reviewSubjects("match")).toEqual([expect.objectContaining({productId,reviewed:false})]);expect((await tx.receiptFacts(result.sourceRevisionId))?.productReviewed).toBe(false);});
 expect(await port.journals("card-a")).toHaveLength(0);
});
it("rolls back admitted receipt evidence on nonexistent product or invalid occurrence",async()=>{
 for(const occurrence of [1,2]) {const port=createMemoryLedger(syntheticSeed()),docs=createMemoryDocuments();await expect(importReceipt(port,docs,input([{occurrence,productId:"999",method:"manual",reviewed:false}]))).rejects.toThrow("invalid_legacy_product_matches");await port.transaction(async tx=>{expect(await tx.acceptedReceipts()).toHaveLength(0);expect(await tx.reviewSubjects("product")).toHaveLength(0);});}
});

it("normal reupload of migrated receipt preserves printed-source identity, reviewed products and immutable objects",async()=>{
 const port=createMemoryLedger(syntheticSeed()),base=createMemoryDocuments(),objects=new Set<string>(),docs={read:base.read,put:async(bytes:Buffer)=>{const ref=await base.put(bytes);objects.add(ref.sha256);return ref;}};
 const productId=await port.transaction(tx=>createProductTx(tx,{name:"Original custom name",category:"pantry",unit:"un",reviewed:true}));
 const migrated=await importReceipt(port,docs,input([{occurrence:1,productId,method:"auto",reviewed:false}]));
 const line=(await port.transaction(tx=>tx.sourceLines(migrated.sourceRevisionId)))[0];
 await reviewReceiptItem(port,{key:"explicit-historical-review",receiptRevisionId:migrated.sourceRevisionId,sourceLineId:line.id,productId,recordedAt:"2026-01-17T12:00:00Z"});
 const before=await port.transaction(async tx=>({facts:await tx.receiptFacts(migrated.sourceRevisionId),matches:await tx.reviewSubjects("match"),products:await tx.reviewSubjects("product")})),objectCount=objects.size;
 const duplicate=await importReceipt(port,docs,{...input(undefined),key:"normal-runtime-reupload"});
 expect(duplicate.duplicate).toBe(true);expect(duplicate.sourceRevisionId).toBe(migrated.sourceRevisionId);expect(duplicate.postedJournalIds).toEqual([]);expect(objects.size).toBe(objectCount);
 await port.transaction(async tx=>{const source=await tx.sourceRevision(migrated.sourceRevisionId);expect(source?.rawPayload).not.toHaveProperty("legacyProductMatches");expect(await tx.sourceRevisions(source!.sourceKey)).toHaveLength(1);expect(await tx.receiptFacts(migrated.sourceRevisionId)).toEqual(before.facts);expect(await tx.reviewSubjects("match")).toEqual(before.matches);expect(await tx.reviewSubjects("product")).toEqual(before.products);expect(await tx.acceptedReceipts()).toHaveLength(1);});
 expect(await port.journals("card-a")).toEqual([]);
 await expect(importReceipt(port,docs,input(undefined))).rejects.toThrow("command_conflict");
});
