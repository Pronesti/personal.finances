import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { baseCatalog, cardAccounts } from "./catalog";
import { createPostgresLedger, migrateAccounting } from "./postgres";
import { createMemoryDocuments } from "./documents";
import { importStatement, type StatementImportInput } from "./statement-import";
const enabled=process.env.ACCOUNTING_PG_TESTS==="1";
async function withLedger(work:(port:ReturnType<typeof createPostgresLedger>,pool:Pool,schema:string)=>Promise<void>) {
  const connectionString=process.env.ACCOUNTING_TEST_DATABASE_URL;
  if(!connectionString) throw new Error("missing_ACCOUNTING_TEST_DATABASE_URL");
  const schema=`acct_test_${randomBytes(12).toString("hex")}`,pool=new Pool({connectionString}),port=createPostgresLedger(connectionString,schema);
  try {
    await migrateAccounting(connectionString,schema);
    const client=await pool.connect();
    try {
      await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
      await client.query("INSERT INTO cards(id) VALUES('card-a')");
      for(const a of [...baseCatalog(),...cardAccounts("card-a","Synthetic card")]) await client.query("INSERT INTO accounts(id,parent_id,type,label_key,custom_name,currency,primary_purpose_id,posting,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[a.id,a.parentId,a.type,a.labelKey,a.customName,a.currency,a.primaryPurposeId,a.posting,a.enabled]);
      await client.query("COMMIT");
    } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();}
    await work(port,pool,schema);
  } finally {await port.close();try{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await pool.end();}}
}
function input():StatementImportInput {
  const json={file:"synthetic_2026.pdf",brand:"visa",period:{closing_date:"2026-01-31"},transactions:[{section:"purchases",block:1,date:"2026-01-15",description:"SYNTHETIC SHOP",voucher:"synthetic-voucher",ars:100,usd:null,installment_number:null,installment_count:null}],declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:100,usd:null}],upcoming_installments:[{month:"2026-02",amount_ars:0}]};
  return {key:"a",cardId:"card-a",filename:json.file,pdf:Buffer.from("%PDF-synthetic-pg-statement"),json,rawJson:Buffer.from(JSON.stringify(json)),recordedAt:"2026-02-01T12:00:00Z",appRevision:"synthetic:integration-test"};
}
describe.skipIf(!enabled)("PostgreSQL statement evidence",()=>{
  it("atomically retains evidence, source facts, concurrent retry identity and backup metadata",async()=>{
    await withLedger(async(port,pool,schema)=>{
      const docs=createMemoryDocuments(),source=input();
      const [a,b]=await Promise.all([importStatement(port,docs,source),importStatement(port,docs,source)]);
      expect(a.sourceRevisionId).toBe(b.sourceRevisionId);expect([a.duplicate,b.duplicate].sort()).toEqual([false,true]);
      expect((await port.journals("card-a")).map(j=>j.kind).sort()).toEqual(["billing","purchase"]);
      const metadata=(await pool.query(`SELECT metadata FROM "${schema}".accounting_backup_metadata`)).rows;
      expect(metadata).toHaveLength(1);
      expect(metadata[0].metadata).toMatchObject({app_revision:"synthetic:integration-test",database:{path:"database.dump",server_major:18}});
      expect(metadata[0].metadata.schema_version).toBeGreaterThanOrEqual(5);
      const refs=metadata[0].metadata.source_references as string[];
      expect(refs).toHaveLength(2);expect(refs.every(ref=>/^objects\/[a-f0-9]{64}$/.test(ref))).toBe(true);
      const revision=await port.transaction(tx=>tx.sourceRevision(a.sourceRevisionId));
      expect(await docs.read(revision!.rawObject!)).toEqual(source.rawJson);
      const facts=await port.transaction(tx=>tx.statementFacts(a.sourceRevisionId));
      expect(facts?.schedules).toEqual(source.json.upcoming_installments);
      await expect(pool.query(`UPDATE "${schema}".source_lines SET payload='{}'`)).rejects.toThrow("immutable_record");
    });
  },20000);
  it("rolls back source and journals together after an account failure; preserves accepted source on revision",async()=>{
    await withLedger(async(port,pool,schema)=>{
      await pool.query(`UPDATE "${schema}".accounts SET enabled=false WHERE id='expense:unallocated'`);
      const docs=createMemoryDocuments();
      await expect(importStatement(port,docs,input())).rejects.toThrow("invalid_posting_account");
      expect((await pool.query(`SELECT count(*)::integer AS n FROM "${schema}".source_revisions`)).rows[0].n).toBe(0);
      expect(await port.journals("card-a")).toEqual([]);
      await pool.query(`UPDATE "${schema}".accounts SET enabled=true WHERE id='expense:unallocated'`);
      const first=await importStatement(port,docs,input()),changed=input();
      changed.key="corrected"; changed.json={...changed.json,transactions:[{...changed.json.transactions[0],ars:101}],declared_totals:[{concept:"TOTAL CONSUMOS DE SYNTHETIC",block:1,ars:101,usd:null}]};changed.rawJson=Buffer.from(JSON.stringify(changed.json));
      const revised=await importStatement(port,docs,changed);
      expect(revised.postedJournalIds).toEqual([]);
      expect((await port.transaction(tx=>tx.currentStatementRevision("card-a")))?.id).toBe(first.sourceRevisionId);
      expect((await port.transaction(tx=>tx.sourceRevision(revised.sourceRevisionId)))?.previousRevisionId).toBe(first.sourceRevisionId);
      expect((await port.journals("card-a")).filter(j=>j.kind==="purchase")).toHaveLength(1);
    });
  },20000);
});
