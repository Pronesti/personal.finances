import { expect, it } from "vitest";
import { compareRecovery, type RecoverySnapshot } from "../../../scripts/accounting-restore-test";
const snapshot = (): RecoverySnapshot => ({version:1,migrations:[1],tables:{journals:{count:2,sha256:"a"}},accountTotals:[],cardTotals:[],componentTotals:[],openingTotals:[],objects:{},files:{},guards:[],errors:[]});
it("reconciles every count and row identity rather than aggregate totals alone", () => {
 const before=snapshot(), after=snapshot();
 expect(compareRecovery(before,after)).toEqual([]);
 after.tables.journals.sha256="b";
 expect(compareRecovery(before,after)).toContain("recovery_mismatch:tables");
});
it("fails closed on invalid baseline, object bytes, guards and actual invariants", () => {
 const before=snapshot(), after=snapshot(); before.errors=["bad"];
 after.objects={x:{size:1,sha256:"different"}}; after.guards=["disabled"]; after.errors=["journals_invalid"];
 expect(compareRecovery(before,after)).toEqual(["journals_invalid","recovery_mismatch:objects","recovery_mismatch:guards","baseline_invalid"]);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { migrateAccounting, createPostgresLedger } from "./postgres";
import { syntheticSeed, purchaseInput, billingInput, paymentInput, balancedJournal } from "./test-support";
import { recordPurchase, billInstallment, recordRepayment, correctPurchase, postJournal } from "./use-cases";
import { checkRecovery } from "../../../scripts/accounting-restore-test";
import { registerOpeningObligation, billOpeningInstallment } from "./opening-obligations";
const pgIt = process.env.ACCOUNTING_PG_RECOVERY_TESTS === "1" ? it : it.skip;
pgIt("roundtrips posted purchase, bill, payment, correction and private files into a fresh database", async () => {
 const sourceUrl=process.env.ACCOUNTING_RECOVERY_SOURCE_URL, targetUrl=process.env.ACCOUNTING_RECOVERY_TARGET_URL;
 if (!sourceUrl || !targetUrl || sourceUrl===targetUrl) throw new Error("explicit_distinct_fresh_recovery_databases_required");
 const source=new Pool({connectionString:sourceUrl}), target=new Pool({connectionString:targetUrl});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"accounting-recovery-")));
 const docs=path.join(root,"docs"), refs=path.join(root,"refs"), moved=path.join(root,"moved"), movedRefs=path.join(root,"moved-refs");
 const port=createPostgresLedger(sourceUrl,"accounting");
 try {
  for(const pool of [source,target]) expect(Number((await pool.query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].count)).toBe(0);
  await migrateAccounting(sourceUrl,"accounting");
  for(const dir of [docs,refs]) fs.mkdirSync(dir,{mode:0o700});
  for(const name of ["objects","pending"]) fs.mkdirSync(path.join(docs,name),{mode:0o700});
  const bytes=Buffer.from("%PDF-synthetic-full-ledger-recovery"), digest=createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(path.join(docs,"objects",digest),bytes,{mode:0o600});fs.writeFileSync(path.join(docs,"pending","correction.rows.txt"),"reviewed pending transcript",{mode:0o600});fs.writeFileSync(path.join(refs,"ipc.json"),"{}",{mode:0o600});
  await source.query("INSERT INTO accounting.cards VALUES('card-a'); INSERT INTO accounting.evidence VALUES('synthetic:e1','synthetic','{}')");
  for(const a of syntheticSeed().accounts) await source.query("INSERT INTO accounting.accounts(id,type,custom_name,currency,posting,enabled) VALUES($1,$2,$3,$4,true,true)",[a.id,a.type,a.customName,a.currency]);
  await source.query("INSERT INTO accounting.source_documents VALUES($1,$1,$2)",[digest,bytes.length]);
  await source.query("INSERT INTO accounting.evidence VALUES('receipt:recovery','receipt','{}')");
  await source.query("INSERT INTO accounting.source_revisions(id,source_key,kind,document_hash,recorded_at,payload_digest,app_revision,payload) VALUES('receipt:recovery','recovery','receipt',$1,now(),$1,'recovery-fixture','{\"admission\":\"pending\"}')",[digest]);
  const original=purchaseInput();await recordPurchase(port,original);await billInstallment(port,billingInput());await recordRepayment(port,paymentInput({amountMinor:5000}));
  await correctPurchase(port,{key:"recovery-fix",cardId:"card-a",purchaseId:"purchase-a",expectedVersion:1,replacement:{...original,allocations:[{accountId:"expense:food",purposeId:"food",minor:60000}]},recordedAt:"2026-03-01T12:00:00Z",reason:"reviewed recovery fixture"});
  await postJournal(port,balancedJournal({id:"recovery-opening",commandKey:"recovery-opening",currency:"USD",kind:"opening",effectiveDate:"2026-01-01",lines:[{accountId:"equity:opening",debitMinor:10000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:"card-a:USD:unbilled",debitMinor:0,creditMinor:6000,purchaseId:null,purposeId:null},{accountId:"card-a:USD:billed",debitMinor:0,creditMinor:4000,purchaseId:null,purposeId:null}]}),"opening-proof");
  await port.transaction(tx=>tx.appendBilling({origin:"opening_balance",id:"recovery-opening-balance",journalId:"recovery-opening",purchaseId:null,cardId:"card-a",currency:"USD",installment:1,amountMinor:4000,effectiveDate:"2026-01-01",purchaseDate:"2026-01-01",components:[{id:"recovery-opening-component",purposeId:null,minor:4000}]}));
  await registerOpeningObligation(port,{id:"recovery-obligation",cardId:"card-a",currency:"USD",openingJournalId:"recovery-opening",evidenceIds:["synthetic:e1"],originalPrincipalMinor:10000,alreadyBilledMinor:4000,remainingMinor:6000,purchaseDate:"2025-12-01",lastBilledInstallment:1,installmentCount:3,allocations:[{purposeId:"unallocated",minor:6000}]});
  await billOpeningInstallment(port,{key:"recovery-next-installment",openingObligationId:"recovery-obligation",cardId:"card-a",currency:"USD",installment:2,amountMinor:3000,effectiveDate:"2026-02-01",recordedAt:"2026-02-02T12:00:00Z",evidenceIds:["synthetic:e1"]});
  const before=await checkRecovery({databaseUrl:sourceUrl,documentRoot:docs,referenceRoot:refs});expect(before.errors).toEqual([]);
  const archive=path.join(root,"backup.zip"), python=path.resolve(process.cwd(),"../scripts/accounting_backup.py");
  function run(command:string,url:string,d:string,r:string,extra:string[]=[]){const u=new URL(url);return spawnSync("python3",[python,command,archive,"--document-root",d,"--reference-root",r,"--app-stopped",...extra],{env:{...process.env,PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1)},encoding:"utf8"});}
  expect(run("create",sourceUrl,docs,refs).status).toBe(0);
  expect(run("restore",targetUrl,moved,movedRefs,["--sha256","0".repeat(64)]).status).toBe(1);expect(fs.existsSync(moved)).toBe(false);
  const originalArchive=fs.readFileSync(archive);
  const tampered=spawnSync("python3",["-c", "import sys,zipfile,json,hashlib; p=sys.argv[1]; z=zipfile.ZipFile(p); entries={n:z.read(n) for n in z.namelist()}; z.close(); m=json.loads(entries['manifest.json']); data=b'invalid PostgreSQL dump'; entries['database.dump']=data; m['files']['database.dump']={'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}; entries['manifest.json']=json.dumps(m).encode(); z=zipfile.ZipFile(p,'w'); [z.writestr(n,d) for n,d in entries.items()]; z.close()",archive]);
  expect(tampered.status).toBe(0);
  expect(run("restore",targetUrl,path.join(root,"failed-docs"),path.join(root,"failed-refs")).status).toBe(1);
  expect(Number((await target.query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].count)).toBe(0);
  expect(fs.existsSync(path.join(root,"failed-docs","objects",digest))).toBe(true);
  fs.writeFileSync(archive,originalArchive);
  expect(run("restore",targetUrl,moved,movedRefs).status).toBe(0);
  const restored=await checkRecovery({databaseUrl:targetUrl,documentRoot:moved,referenceRoot:movedRefs});expect(compareRecovery(before,restored)).toEqual([]);
  expect(restored.tables.journals.count).toBe(7);expect(restored.openingTotals).toEqual([expect.objectContaining({supported_remaining:"6000",future_billed:"3000",current_remaining:"3000"})]);expect(restored.tables.correction_links.count).toBe(1);
  const immutableClient=await target.connect();
  try {await immutableClient.query("BEGIN");await expect(immutableClient.query("UPDATE accounting.journals SET effective_date=effective_date")).rejects.toThrow("immutable_posted_journal");await immutableClient.query("ROLLBACK");await immutableClient.query("BEGIN");await expect(immutableClient.query("UPDATE accounting.source_revisions SET app_revision=app_revision")).rejects.toThrow("immutable_record");await immutableClient.query("ROLLBACK");} finally {immutableClient.release();}
  expect(run("restore",targetUrl,path.join(root,"third"),path.join(root,"third-refs")).status).toBe(1);
  fs.writeFileSync(path.join(moved,"objects",digest),"corrupt");expect((await checkRecovery({databaseUrl:targetUrl,documentRoot:moved,referenceRoot:movedRefs})).errors).toContain("source_object_missing_or_corrupt");
  expect(compareRecovery(before,await checkRecovery({databaseUrl:sourceUrl,documentRoot:docs,referenceRoot:refs}))).toEqual([]);
 } finally {await port.close();await source.end();await target.end();fs.rmSync(root,{recursive:true,force:true});}
},60_000);
