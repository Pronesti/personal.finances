import {expect,it,onTestFinished} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import Database from "better-sqlite3";
import {Pool} from "pg";
import {migrate} from "../db";
import {reconstruct,type ReconstructionInput} from "./reconstruction";
import {createPostgresLedger} from "./postgres";
const pgIt=process.env.ACCOUNTING_PG_TESTS==="1"?it:it.skip;
export async function partialHistoryInput():Promise<ReconstructionInput> {
 const targetUrl=process.env.ACCOUNTING_TEST_DATABASE_URL;if(!targetUrl)throw Error("missing_explicit_test_database_url");
 const base=fs.mkdtempSync(path.join(os.tmpdir(),"accounting-history-")),sourceRoot=path.join(base,"source"),schema=`acct_test_${randomBytes(12).toString("hex")}`;
 for(const name of ["data","json","pdfs"])fs.mkdirSync(path.join(sourceRoot,name),{recursive:true});
 onTestFinished(async()=>{const pool=new Pool({connectionString:targetUrl});try{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await pool.end();fs.rmSync(base,{recursive:true,force:true});}});
 const db=new Database(path.join(sourceRoot,"data/app.db"));migrate(db);
 db.prepare("INSERT INTO statements(id,file,brand,closing_date,cycle_month,balance_ars,balance_usd) VALUES(1,'partial.pdf','visa','2026-03-01','2026-02',100,0)").run();
 db.prepare("INSERT INTO transactions(id,statement_id,section,date,description,merchant,category,ars,installment_number,installment_count) VALUES(1,1,'purchases','2026-01-01','PARTIAL PLAN','PARTIAL PLAN','other',100,3,6)").run();db.close();
 const json={file:"partial.pdf",brand:"visa",period:{closing_date:"2026-03-01",previous_closing_date:"2026-02-01"},balances:{current_ars:100,current_usd:0},upcoming_installments:[],transactions:[{section:"purchases",date:"2026-01-01",description:"PARTIAL PLAN",ars:100,usd:null,installment_number:3,installment_count:6}]};
 fs.writeFileSync(path.join(sourceRoot,"json/partial.json"),JSON.stringify(json));fs.writeFileSync(path.join(sourceRoot,"pdfs/partial.pdf"),"%PDF-synthetic");
 fs.writeFileSync(path.join(sourceRoot,"issuer-principal.json"),JSON.stringify({billedMinor:10000,futurePrincipalMinor:30000,observationDate:"2026-03-01"}));
 return {sourceRoot,targetUrl,cutoffDate:"2026-03-01",mode:"opening",schema,documentRoot:path.join(base,"documents/objects"),cardRegistry:{cards:[{id:"card-a",displayName:"Synthetic card",statementFiles:["partial.pdf"]}]},appRevision:"synthetic:test",openingEvidence:[{cardId:"card-a",currency:"ARS",observationDate:"2026-03-01",billedMinor:10000,unbilledMinor:30000,evidencePaths:["issuer-principal.json","pdfs/partial.pdf"]}]};
}
pgIt("opens supported400principal without inventing earlier expense/payments and replays deterministically",async()=>{
 const startedAt=Date.now(),input=await partialHistoryInput(),report=await reconstruct(input),port=createPostgresLedger(input.targetUrl,input.schema);
 try {
  const journals=await port.journals("card-a");expect(Date.parse(journals[0].recordedAt)).toBeGreaterThanOrEqual(startedAt);expect(Date.parse(journals[0].recordedAt)).toBeLessThanOrEqual(Date.now());expect(journals.map(j=>j.kind)).toEqual(["opening"]);
  expect(journals[0].lines.reduce((sum,l)=>sum+l.creditMinor,0)).toBe(40000);
  expect(journals[0].lines.find(l=>l.accountId==="card-a:ARS:unbilled")?.creditMinor).toBe(30000);
  const replay=await reconstruct(input);expect(replay).toEqual(report);expect(await port.journals("card-a")).toHaveLength(1);
  expect(report.sourceCounts.transactions).toBe(1);expect(report.retainedCounts.transactions).toBe(1);
 }finally{await port.close();}
});
