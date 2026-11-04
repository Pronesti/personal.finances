import {expect,it} from "vitest";
import {createMemoryLedger} from "./memory";
import {syntheticSeed} from "./test-support";
import {createMemoryDocuments} from "./documents";
import {importStatement} from "./statement-import";
import type {StatementJson} from "../integrity";
it("retains accepted historical observations without purchase, payment or auto receipt posting in opening mode",async()=>{
 const port=createMemoryLedger(syntheticSeed()),json:StatementJson={file:"history.pdf",brand:"visa",period:{closing_date:"2026-03-01"},balances:{current_ars:100},transactions:[{section:"purchases",date:"2026-02-01",description:"SHOP",ars:100,usd:null,installment_number:null,installment_count:null},{section:"payments",date:"2026-02-01",description:"SU PAGO",ars:-100,usd:null,installment_number:null,installment_count:null}]};
 const result=await importStatement(port,createMemoryDocuments(),{key:"opening-history",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-03-01T12:00:00Z",appRevision:"test",observationOnly:true});
 expect(result.postedJournalIds).toEqual([]);expect(await port.journals("card-a")).toEqual([]);
 await port.transaction(async tx=>{expect((await tx.sourceRevision(result.sourceRevisionId))?.admission).toBe("accepted");expect(await tx.sourceLines(result.sourceRevisionId)).toHaveLength(2);});
});
