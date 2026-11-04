import type {LedgerPort} from "./port";
import {createMemoryDocuments} from "./documents";
import {importReceipt} from "./receipt-import";
import {receiptExtraction} from "./receipt-test-support";
import {importStatement} from "./statement-import";
import type {StatementJson} from "../integrity";
export async function historicalLinkFixture(port:LedgerPort,overrides:Partial<StatementJson["transactions"][number]>={}) {
 const docs=createMemoryDocuments(),receipts=[];
 for(let i=1;i<=2;i++)receipts.push(await importReceipt(port,docs,{key:`receipt-${i}`,bytes:Buffer.from(`%PDF-historical-receipt-${i}`),extraction:receiptExtraction({fiscalNumber:`0001-0000000${i}`}),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"}));
 const json:StatementJson={file:"historical.pdf",brand:"visa",period:{closing_date:"2026-01-31"},balances:{current_ars:40},transactions:[{section:"purchases",date:"2026-01-15",description:"COTO SYNTHETIC",ars:40,usd:null,installment_number:1,installment_count:2,...overrides}]};
 const statement=await importStatement(port,docs,{key:"historical",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-historical-statement"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-01T12:00:00Z",appRevision:"synthetic:test",observationOnly:true});
 const line=(await port.transaction(tx=>tx.sourceLines(statement.sourceRevisionId)))[0];
 return {receipts,line,input:{key:"original-link",receiptRevisionId:receipts[0].sourceRevisionId,sourceLineId:line.id,action:"link" as const,expectedPreviousDecisionId:null,method:"auto" as const,recordedAt:"2026-01-17T12:00:00Z",legacyFingerprint:line.legacyFingerprint,provenance:{legacyCreatedAt:"2026-01-17T12:00:00Z"}}};
}
