import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach,beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./documents";
import { createMemoryReader } from "./read-model";
import { baseCatalog, cardAccounts } from "./catalog";
import { receiptExtraction } from "./receipt-test-support";
import type { AccountingContext } from "@/lib/backend";
const state=vi.hoisted(()=>({locale:"en" as "en"|"es",fail:false,refs:"",context:null as unknown as AccountingContext,parse:vi.fn(),extract:vi.fn(),sqlite:vi.fn()}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",withAccounting:async<T>(work:(context:AccountingContext)=>Promise<T>)=>{if(state.fail)throw Error("SECRET_DATABASE_PROVIDER_DETAILS");return work(state.context);}}));
vi.mock("@/lib/locale",()=>({getLocale:async()=>state.locale}));
vi.mock("@/lib/db",async importOriginal=>({...await importOriginal<object>(),getDb:state.sqlite}));
vi.mock("@/lib/upload",async importOriginal=>({...await importOriginal<object>(),parseStatementUpload:state.parse}));
vi.mock("@/lib/receipts/ingest",async importOriginal=>({...await importOriginal<object>(),extractReceipt:state.extract}));
import { POST as uploadStatement } from "@/app/api/upload/route";
import { POST as uploadReceipt } from "@/app/api/receipts/route";
import { POST as correctReceipt } from "@/app/api/receipts/corrected/route";
import { ReceiptRejected } from "@/lib/receipts/ingest";
const pdf="%PDF-synthetic-http-receipt";
beforeEach(()=>{
 state.locale="en";state.fail=false;state.refs=mkdtempSync(path.join(os.tmpdir(),"receipt-http-refs-"));writeFileSync(path.join(state.refs,"ipc.json"),JSON.stringify({"2026-01":100}));vi.stubEnv("TARJETAS_REFERENCE_DIR",state.refs);vi.clearAllMocks();state.sqlite.mockImplementation(()=>{throw new Error("SQLite must not open in PostgreSQL mode");});
 const ledger=Object.assign(createMemoryLedger({accounts:[...baseCatalog(),...cardAccounts("card-a","Synthetic card")],cardIds:["card-a"]}),{close:async()=>{}});
 state.context={ledger,reader:createMemoryReader(),documents:createMemoryDocuments(),documentRoot:"/unused-synthetic",appRevision:"synthetic:http-test"};
 state.extract.mockResolvedValue(receiptExtraction());
 state.parse.mockImplementation(async(bytes:Buffer,filename:string)=>{const json={file:filename,brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"MERPAGO*COTO",ars:80,usd:null,installment_number:null,installment_count:null}]};return {json,rawJson:Buffer.from(JSON.stringify(json)),pdf:bytes};});
});
function multipart(cardId?:string){const form=new FormData();form.set("file",new File([pdf],"synthetic_2026.pdf",{type:"application/pdf"}));if(cardId)form.set("cardId",cardId);return new Request("http://localhost/api/upload",{method:"POST",body:form});}
it("requires explicit actual card for HTTP statements and never opens SQLite",async()=>{
 const missing=await uploadStatement(multipart());expect(missing.status).toBe(400);expect((await missing.json()).code).toBe("missing_card_identity");expect(state.parse).not.toHaveBeenCalled();
 const stored=await uploadStatement(multipart("card-a"));expect(stored.status).toBe(200);const json=await stored.json();expect(json.sourceRevisionId).toBeTruthy();expect(json.brand).toBe("visa");expect(json.cardId).toBe("card-a");expect(await state.context.ledger.journals("card-a")).toHaveLength(2);expect(state.sqlite).not.toHaveBeenCalled();
});
it("returns existing receipt response shape using actual PostgreSQL services and persisted numeric identity",async()=>{
 const response=await uploadReceipt(multipart());expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({id:1,totalCents:8000,items:1,report:{ok:true}});expect(body.sourceRevisionId).toBeTruthy();expect(state.sqlite).not.toHaveBeenCalled();
});
it("retains a rejected attempt and accepts corrected HTTP rows with the same receipt identity",async()=>{
 const bad=receiptExtraction({totalCents:8001}),sha256=createHash("sha256").update(pdf).digest("hex");
 state.extract.mockRejectedValue(new ReceiptRejected({report:bad.report,rowsText:bad.rowsText,sha256,scale:2}));
 const rejected=await uploadReceipt(multipart());expect(rejected.status).toBe(422);expect(await rejected.json()).toMatchObject({code:"verification_failed",sha256,scale:2,report:{ok:false}});
 const corrected=await correctReceipt(new Request("http://localhost/api/receipts/corrected",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sha256,rowsText:receiptExtraction().rowsText})}));
 expect(corrected.status).toBe(200);expect(await corrected.json()).toMatchObject({id:1,totalCents:8000,report:{ok:true}});expect(state.sqlite).not.toHaveBeenCalled();
});
it("returns structured bad correction errors without falling back to SQLite",async()=>{
 const response=await correctReceipt(new Request("http://localhost/api/receipts/corrected",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sha256:"../escape",rowsText:"bad"})}));expect(response.status).toBe(400);expect((await response.json()).code).toBe("pending_missing");expect(state.sqlite).not.toHaveBeenCalled();
});

afterEach(()=>{vi.unstubAllEnvs();rmSync(state.refs,{recursive:true,force:true});});
it("returns localized structured 500 responses from all PostgreSQL APIs without leaking unexpected failure details",async()=>{
 const messages=[];for(const locale of ["en","es"] as const){state.locale=locale;state.fail=true;const responses=[await uploadStatement(multipart("card-a")),await uploadReceipt(multipart()),await correctReceipt(new Request("http://localhost/api/receipts/corrected",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sha256:"a".repeat(64),rowsText:"synthetic"})}))];
 for(const response of responses){expect(response.status).toBe(500);const body=await response.json();expect(body.code).toBe("ingest_failed");expect(body.message).toBeTruthy();expect(JSON.stringify(body)).not.toContain("SECRET_DATABASE_PROVIDER_DETAILS");messages.push(body.message);}expect(state.sqlite).not.toHaveBeenCalled();}
 expect(messages[0]).not.toBe(messages[3]);expect(new Set(messages.slice(0,3)).size).toBe(1);expect(new Set(messages.slice(3)).size).toBe(1);
});
it("preserves parsed brand and midpoint cycle while reading CPI lag from the selected reference directory",async()=>{
 state.parse.mockImplementation(async(bytes:Buffer,filename:string)=>{const json={file:filename,brand:"mastercard",period:{closing_date:"2026-10-01",previous_closing_date:"2026-09-01"},transactions:[]};return {json,rawJson:Buffer.from(JSON.stringify(json)),pdf:bytes};});
 writeFileSync(path.join(state.refs,"ipc.json"),JSON.stringify({"2026-08":100}));
 const stale=await uploadStatement(multipart("card-a"));expect(stale.status).toBe(200);expect(await stale.json()).toMatchObject({brand:"mastercard",cardId:"card-a",cycle_month:"2026-09",cpi_stale:true});
 writeFileSync(path.join(state.refs,"ipc.json"),JSON.stringify({"2026-08":100,"2026-09":110}));
 const current=await uploadStatement(multipart("card-a"));expect(current.status).toBe(200);expect(await current.json()).toMatchObject({brand:"mastercard",cardId:"card-a",cycle_month:"2026-09",cpi_stale:false});expect(state.sqlite).not.toHaveBeenCalled();
});
it("returns existing duplicate feedback before OCR when a corrected accepted PDF is uploaded again under another filename",async()=>{
 const bad=receiptExtraction({totalCents:8001}),sha256=createHash("sha256").update(pdf).digest("hex");
 state.extract.mockRejectedValue(new ReceiptRejected({report:bad.report,rowsText:bad.rowsText,sha256,scale:2}));expect((await uploadReceipt(multipart())).status).toBe(422);
 const correction=await correctReceipt(new Request("http://localhost/api/receipts/corrected",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sha256,rowsText:receiptExtraction().rowsText})}));expect(correction.status).toBe(200);
 const before=await state.context.ledger.transaction(async tx=>({source:await tx.sourceByDocument("receipt",sha256),receipts:await tx.acceptedReceipts()})),journals=await state.context.ledger.journals("card-a"),put=vi.spyOn(state.context.documents,"put");
 state.extract.mockClear();state.extract.mockRejectedValue(Error("OCR_MUST_NOT_RUN"));const renamed=new FormData();renamed.set("file",new File([pdf],"different_filename.pdf",{type:"application/pdf"}));
 const response=await uploadReceipt(new Request("http://localhost/api/receipts",{method:"POST",body:renamed}));expect(response.status).toBe(400);const body=await response.json();expect(body.code).toBe("duplicate_receipt");expect(body.message).toContain("1");expect(body.message).toContain("2026-01-15");expect(state.extract).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();expect(await state.context.ledger.transaction(async tx=>({source:await tx.sourceByDocument("receipt",sha256),receipts:await tx.acceptedReceipts()}))).toEqual(before);expect(await state.context.ledger.journals("card-a")).toEqual(journals);expect(before.receipts[0].correctedRowsObject).toBeTruthy();
});
it("reports corrupt or missing stored PDF honestly before duplicate feedback or OCR",async()=>{
 const {createLocalDocuments}=await import("./documents"),root=mkdtempSync(path.join(os.tmpdir(),"receipt-http-docs-"));state.context.documents=createLocalDocuments(root);
 try{
  expect((await uploadReceipt(multipart())).status).toBe(200);const hash=createHash("sha256").update(pdf).digest("hex"),before=await state.context.ledger.transaction(tx=>tx.sourceByDocument("receipt",hash));state.extract.mockClear();
  writeFileSync(path.join(root,hash),"%PDF-corrupted-object");const corrupt=await uploadReceipt(multipart());expect(corrupt.status).toBe(400);expect((await corrupt.json()).code).toBe("document_hash_mismatch");
  rmSync(path.join(root,hash));const missing=await uploadReceipt(multipart());expect(missing.status).toBe(400);expect((await missing.json()).code).toBe("document_missing");expect(state.extract).not.toHaveBeenCalled();expect(await state.context.ledger.transaction(tx=>tx.sourceByDocument("receipt",hash))).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
