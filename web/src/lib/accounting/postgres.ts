import {postgresReviewTx} from "./review-postgres";
import { postgresCatalogTx } from "./catalog-postgres";
import { postgresEvidenceTx } from "./evidence-postgres";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { AccountingError, type Account, type Journal, type CommandReceipt, type PurchaseVersion, type Billing, type Payment, type Attribution, type LinkedCredit, type ComponentRevision } from "./model";
import { outstandingComponents } from "./attribution";
import { validateJournal } from "./journal";
import type { LedgerPort, LedgerTx } from "./port";
export function accountingSchema(schema = "accounting"): string {
  if (schema !== "accounting" && !/^acct_test_[a-f0-9]+$/.test(schema)) throw new AccountingError("invalid_accounting_schema");
  return schema;
}
async function begin(client: PoolClient, schema: string) {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(8581401)");
  await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog, pg_temp`);
}
export async function migrateAccounting(connectionString: string, schema = "accounting"): Promise<void> {
  if (!connectionString) throw new AccountingError("missing_database_url");
  accountingSchema(schema);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 }); const client = await pool.connect();
  try {
    await begin(client, schema);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const found = await client.query("SELECT to_regclass($1) AS name", [`${schema}.schema_migrations`]);
    const applied = found.rows[0].name
      ? new Set((await client.query("SELECT version FROM schema_migrations")).rows.map(row => Number(row.version)))
      : new Set<number>();
    const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
    const files = (await readdir(directory)).filter(name => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort();
    const versions = files.map(name => Number(name.slice(0, 3)));
    if (new Set(versions).size !== versions.length) throw new AccountingError("duplicate_migration_version");
    for (const filename of files) {
      const version = Number(filename.slice(0, 3));
      if (!applied.has(version)) await client.query(await readFile(path.join(directory, filename), "utf8"));
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
function minor(value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 0) throw new AccountingError("invalid_minor_units");
  return n;
}
function transactionAdapter(client: PoolClient): LedgerTx {
  return {
    async openingObligation(id) {const r=await client.query("SELECT payload FROM opening_obligations WHERE id=$1",[id]);return r.rows[0]?.payload??null;},
    async openingObligations(cardId,currency) {const r=await client.query("SELECT payload FROM opening_obligations WHERE card_id=$1 AND currency=$2 ORDER BY id",[cardId,currency]);return r.rows.map(r=>r.payload);},
    async appendOpeningObligation(o) {await client.query("INSERT INTO opening_obligations VALUES($1,$2,$3,$4,$5)",[o.id,o.cardId,o.currency,o.openingJournalId,o]);for(const evidenceId of o.evidenceIds) await client.query("INSERT INTO opening_obligation_evidence VALUES($1,$2)",[o.id,evidenceId]);},
    async openingBillings(id) {const r=await client.query("SELECT payload FROM billings WHERE opening_obligation_id=$1 ORDER BY installment",[id]);return r.rows.map(r=>r.payload);},
    async openingDate(cardId, currency) { const result = await client.query("SELECT coalesce(max(effective_date) FILTER (WHERE currency=$2),max(effective_date))::text AS date FROM journals WHERE status='posted' AND kind='opening' AND card_id=$1", [cardId, currency]); return result.rows[0].date; },
    ...postgresEvidenceTx(client),
    ...postgresCatalogTx(client),
    ...postgresReviewTx(client),
    async appendAttributionRevision(r) {await client.query("INSERT INTO attribution_revisions VALUES($1,$2,$3)",[r.paymentId,r.revision,r.unappliedMinor]);},
    async appendCreditRevision(r) {await client.query("INSERT INTO credit_revisions VALUES($1,$2,$3,$4,$5,$6,$7)",[r.id,r.creditId,r.purchaseVersion,r.reversalJournalId,r.replacementJournalId,r.recordedAt,r.credit]);},
    async journal(id) {return loadJournal(client,id);},
    async appendCorrection(c) {await client.query("INSERT INTO correction_links VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[c.id,c.purchaseId,c.fromVersion,c.toVersion,c.reversalJournalId,c.replacementJournalId,c.reason,c.recordedAt]);},
    async appendComponentRevisions(rows) {for(const r of rows) {if(r.minor>0) await client.query("INSERT INTO billed_components VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[r.componentId,r.billingId,r.purposeId,r.minor]);await client.query("INSERT INTO component_revisions VALUES($1,$2,$3,$4,$5,$6,$7)",[r.id,r.componentId,r.billingId,r.revision,r.purposeId,r.minor,r.purchaseDate]);}},
    async attributionState(cardId,currency) {
      const bills=await client.query("SELECT payload FROM billings WHERE card_id=$1 AND currency=$2",[cardId,currency]);
      const payments=await client.query("SELECT payload FROM payments WHERE card_id=$1 AND currency=$2",[cardId,currency]);
      const attrs=await client.query('SELECT a.id,a.payment_id AS "paymentId",a.component_id AS "componentId",a.purpose_id AS "purposeId",a.minor::text,a.method,a.revision FROM attributions a JOIN payments p ON p.id=a.payment_id WHERE p.card_id=$1 AND p.currency=$2',[cardId,currency]);
      const credits=await client.query("SELECT coalesce((SELECT r.payload FROM credit_revisions r WHERE r.credit_id=c.id ORDER BY r.purchase_version DESC LIMIT 1),c.payload) AS payload FROM linked_credits c JOIN purchases p ON p.id=c.purchase_id WHERE p.card_id=$1 AND p.currency=$2",[cardId,currency]);
      const revisions=await readComponentRevisions(client,cardId,currency);
      return {billings:bills.rows.map(r=>r.payload as Billing),payments:payments.rows.map(r=>r.payload as Payment),attributions:attrs.rows.map(r=>({...r,minor:minor(r.minor)} as Attribution)),credits:credits.rows.map(r=>r.payload as LinkedCredit),componentRevisions:revisions,attributionRevisions:await readAttributionRevisions(client,cardId,currency)};
    },
    async purchase(id) {const r=await client.query("SELECT payload FROM purchase_versions WHERE purchase_id=$1 ORDER BY version DESC LIMIT 1",[id]);return r.rows[0]?.payload as PurchaseVersion??null;},
    async appendPurchase(p) {await client.query("INSERT INTO purchases VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[p.purchaseId,p.cardId,p.currency]);await client.query("INSERT INTO purchase_versions VALUES($1,$2,$3,$4,$5)",[p.purchaseId,p.version,p.journalId,p.principalMinor,p]);},
    async billings(id) {const r=await client.query("SELECT payload FROM billings WHERE purchase_id=$1 ORDER BY installment",[id]);return r.rows.map(r=>r.payload as Billing);},
    async appendBilling(b) {await client.query("INSERT INTO billings(id,purchase_id,card_id,currency,installment,amount_minor,journal_id,payload,opening_obligation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[b.id,b.purchaseId,b.cardId,b.currency,b.installment,b.amountMinor,b.journalId,b,b.openingObligationId??null]);for(const c of b.components) await client.query("INSERT INTO billed_components VALUES($1,$2,$3,$4)",[c.id,b.id,c.purposeId,c.minor]);},
    async billedComponents(currency,cardId) {const bills=await client.query("SELECT payload FROM billings WHERE currency=$1 AND card_id=$2",[currency,cardId]);const attrs=await client.query('SELECT a.id,a.payment_id AS "paymentId",a.component_id AS "componentId",a.purpose_id AS "purposeId",a.minor::text,a.method,a.revision FROM attributions a JOIN payments p ON p.id=a.payment_id WHERE p.currency=$1 AND p.card_id=$2',[currency,cardId]);const credits=await client.query("SELECT coalesce((SELECT r.payload FROM credit_revisions r WHERE r.credit_id=c.id ORDER BY r.purchase_version DESC LIMIT 1),c.payload) AS payload FROM linked_credits c JOIN purchases p ON p.id=c.purchase_id WHERE p.currency=$1 AND p.card_id=$2",[currency,cardId]);const paymentRows=await client.query("SELECT payload FROM payments WHERE currency=$1 AND card_id=$2",[currency,cardId]);return outstandingComponents(bills.rows.map(r=>r.payload as Billing),attrs.rows.map(r=>({...r,minor:minor(r.minor)} as Attribution)),credits.rows.map(r=>r.payload as LinkedCredit),await readComponentRevisions(client,cardId,currency),await readAttributionRevisions(client,cardId,currency),paymentRows.rows.map(r=>r.payload as Payment));},
    async appendPayment(p) {await client.query("INSERT INTO payments VALUES($1,$2,$3,$4,$5,$6)",[p.id,p.cardId,p.currency,p.amountMinor,p.journalId,p]);},
    async appendAttributions(rows) {for(const a of rows) await client.query("INSERT INTO attributions VALUES($1,$2,$3,$4,$5,$6,$7)",[a.id,a.paymentId,a.componentId,a.purposeId,a.minor,a.method,a.revision]);},
    async linkedCredits(id) {const r=await client.query("SELECT coalesce((SELECT r.payload FROM credit_revisions r WHERE r.credit_id=c.id ORDER BY r.purchase_version DESC LIMIT 1),c.payload) AS payload FROM linked_credits c WHERE purchase_id=$1 ORDER BY id",[id]);return r.rows.map(r=>r.payload as LinkedCredit);},
    async appendLinkedCredit(c) {await client.query("INSERT INTO linked_credits VALUES($1,$2,$3,$4,$5)",[c.id,c.purchaseId,c.journalId,c.amountMinor,c]);},
    async command(key) { const r = await client.query("SELECT key,digest,result FROM commands WHERE key=$1", [key]); return r.rows[0] as CommandReceipt ?? null; },
    async account(id) { const r = await client.query('SELECT id,parent_id AS "parentId",type,label_key AS "labelKey",custom_name AS "customName",currency,primary_purpose_id AS "primaryPurposeId",posting,enabled FROM accounts WHERE id=$1', [id]); return r.rows[0] as Account ?? null; },
    async hasChildAccounts(id) { const r = await client.query("SELECT 1 FROM accounts WHERE parent_id=$1 LIMIT 1", [id]); return !!r.rowCount; },
    async appendJournal(j) {
      validateJournal(j);
      await client.query("INSERT INTO journals(id,command_key,card_id,currency,effective_date,recorded_at,kind,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [j.id,j.commandKey,j.cardId,j.currency,j.effectiveDate,j.recordedAt,j.kind,j.reversesId]);
      for (let i=0;i<j.lines.length;i++) { const l=j.lines[i]; await client.query("INSERT INTO journal_lines VALUES($1,$2,$3,$4,$5,$6,$7)", [j.id,i,l.accountId,l.debitMinor,l.creditMinor,l.purchaseId,l.purposeId]); }
      for (const id of j.evidenceIds) await client.query("INSERT INTO journal_evidence VALUES($1,$2)", [j.id,id]);
      await client.query("UPDATE journals SET status='posted' WHERE id=$1", [j.id]);
    },
    async appendCommand(r) { await client.query("INSERT INTO commands(key,card_id,digest,result) VALUES($1,$2,$3,$4)", [r.key,r.key.startsWith("card:") ? decodeURIComponent(r.key.split(":")[1]) : null,r.digest,r.result]); },
  };
}
export function createPostgresLedger(connectionString: string, schema = "accounting"): LedgerPort & { close(): Promise<void> } {
  accountingSchema(schema);
  if (!connectionString) throw new AccountingError("missing_database_url");
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  return {
    async transaction(work) {
      const client = await pool.connect();
      try { await begin(client,schema); const result=await work(transactionAdapter(client)); const committed=await client.query("COMMIT"); if (committed.command !== "COMMIT") throw new AccountingError("ledger_transaction_aborted"); return result; }
      catch (error) { await client.query("ROLLBACK"); if (error instanceof AccountingError) throw error; throw new AccountingError("ledger_transaction_failed", { reason: error instanceof Error ? error.message : "unknown" }); }
      finally { client.release(); }
    },
    async journals(cardId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog, pg_temp`);
        const headers=await client.query("SELECT *,effective_date::text AS date_text FROM journals WHERE card_id=$1 AND status='posted' ORDER BY recorded_at,id",[cardId]);
        const out: Journal[]=[];
        for (const h of headers.rows) {
          const lines=await client.query("SELECT * FROM journal_lines WHERE journal_id=$1 ORDER BY ordinal",[h.id]);
          const evidence=await client.query("SELECT evidence_id FROM journal_evidence WHERE journal_id=$1 ORDER BY evidence_id",[h.id]);
          out.push({ id:h.id,commandKey:h.command_key,cardId:h.card_id,currency:h.currency,effectiveDate:h.date_text,recordedAt:h.recorded_at.toISOString(),kind:h.kind,reversesId:h.reverses_id,evidenceIds:evidence.rows.map(e=>e.evidence_id),lines:lines.rows.map(l=>({accountId:l.account_id,debitMinor:minor(l.debit_minor),creditMinor:minor(l.credit_minor),purchaseId:l.purchase_id,purposeId:l.purpose_id})) });
        }
        await client.query("COMMIT"); return out;
      } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

async function readComponentRevisions(client: PoolClient,cardId: string,currency: string):Promise<ComponentRevision[]> {
 const r=await client.query('SELECT r.id,r.component_id AS "componentId",r.billing_id AS "billingId",r.revision,r.purpose_id AS "purposeId",r.minor::text,r.purchase_date::text AS "purchaseDate" FROM component_revisions r JOIN billings b ON b.id=r.billing_id WHERE b.card_id=$1 AND b.currency=$2',[cardId,currency]);
 return r.rows.map(row=>({...row,minor:minor(row.minor)} as ComponentRevision));
}
async function loadJournal(client:PoolClient,id:string):Promise<Journal|null> {
 const r=await client.query("SELECT *,effective_date::text AS date_text FROM journals WHERE id=$1 AND status='posted'",[id]);const h=r.rows[0];if(!h) return null;
 const lines=await client.query("SELECT * FROM journal_lines WHERE journal_id=$1 ORDER BY ordinal",[id]);
 const evidence=await client.query("SELECT evidence_id FROM journal_evidence WHERE journal_id=$1 ORDER BY evidence_id",[id]);
 return {id:h.id,commandKey:h.command_key,cardId:h.card_id,currency:h.currency,effectiveDate:h.date_text,recordedAt:h.recorded_at.toISOString(),kind:h.kind,reversesId:h.reverses_id,evidenceIds:evidence.rows.map(e=>e.evidence_id),lines:lines.rows.map(l=>({accountId:l.account_id,debitMinor:minor(l.debit_minor),creditMinor:minor(l.credit_minor),purchaseId:l.purchase_id,purposeId:l.purpose_id}))};
}

async function readAttributionRevisions(client:PoolClient,cardId:string,currency:string):Promise<import("./model").AttributionRevision[]> {
 const r=await client.query('SELECT r.payment_id AS "paymentId",r.revision,r.unapplied_minor::text AS "unappliedMinor" FROM attribution_revisions r JOIN payments p ON p.id=r.payment_id WHERE p.card_id=$1 AND p.currency=$2',[cardId,currency]);return r.rows.map(r=>({...r,unappliedMinor:minor(r.unappliedMinor)}));
}
