import { expect, it } from "vitest";
import { createEvidenceMemoryState, memoryEvidenceTx } from "./evidence-memory";
import { retainSourceTx } from "./evidence";
const hash="a".repeat(64), rawHash="b".repeat(64);
const input={key:"a",cardId:"card-a",kind:"statement" as const,documentHash:hash,objectPath:hash,rawPayload:{file:"old.pdf",amount:100},previousRevisionId:null,recordedAt:"2026-01-16T12:00:00Z",fiscalId:null,closingDate:"2026-01-31",rawObject:{sha256:rawHash,relativePath:rawHash},appRevision:"synthetic:test"};
it("requires registered objects before source admission",async()=>{
 const tx=memoryEvidenceTx(createEvidenceMemoryState(),()=>{});
 await expect(retainSourceTx(tx,input)).rejects.toThrow("missing_source_object");
 await tx.appendSourceObject({sha256:hash,relativePath:hash,byteLength:100});
 await expect(retainSourceTx(tx,input)).rejects.toThrow("missing_source_object");
});
it("retains revisions and immutable raw-object references, with renamed evidence deduplicated",async()=>{
 const state=createEvidenceMemoryState(), ids:string[]=[],tx=memoryEvidenceTx(state,id=>ids.push(id));
 await tx.appendSourceObject({sha256:hash,relativePath:hash,byteLength:100});
 await tx.appendSourceObject({sha256:rawHash,relativePath:rawHash,byteLength:200});
 const first=await retainSourceTx(tx,input);
 const renamed=await retainSourceTx(tx,{...input,key:"renamed",rawPayload:{amount:100,file:"renamed.pdf"}});
 expect(renamed).toEqual({revisionId:first.revisionId,status:"duplicate"});
 const revised=await retainSourceTx(tx,{...input,key:"corrected",rawPayload:{file:"old.pdf",amount:101},admission:"pending"});
 expect(revised.status).toBe("revision");
 expect((await tx.sourceRevision(revised.revisionId))?.previousRevisionId).toBe(first.revisionId);
 expect((await tx.sourceRevision(first.revisionId))?.rawObject).toEqual(input.rawObject);
 expect(ids).toEqual([first.revisionId,revised.revisionId]);
 expect((await retainSourceTx(tx,input)).revisionId).toBe(first.revisionId);
 expect(state.revisions).toHaveLength(2);
});
it("rejects a shared source document claimed for another actual card",async()=>{
 const tx=memoryEvidenceTx(createEvidenceMemoryState(),()=>{});
 await tx.appendSourceObject({sha256:hash,relativePath:hash,byteLength:100});
 await tx.appendSourceObject({sha256:rawHash,relativePath:rawHash,byteLength:200});
 await retainSourceTx(tx,input);
 await expect(retainSourceTx(tx,{...input,cardId:"card-b"})).rejects.toThrow("document_identity_conflict");
});
it("owns cloned stored and returned source payloads",async()=>{
 const tx=memoryEvidenceTx(createEvidenceMemoryState(),()=>{});
 await tx.appendSourceObject({sha256:hash,relativePath:hash,byteLength:100});
 await tx.appendSourceObject({sha256:rawHash,relativePath:rawHash,byteLength:200});
 const payload={nested:{amount:100}},r=await retainSourceTx(tx,{...input,rawPayload:payload});
 payload.nested.amount=1;
 const copy=await tx.sourceRevision(r.revisionId);
 (copy!.rawPayload as typeof payload).nested.amount=2;
 expect((await tx.sourceRevision(r.revisionId))?.rawPayload).toEqual({nested:{amount:100}});
});
