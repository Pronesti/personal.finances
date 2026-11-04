import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { Account, Journal, PurchaseInput, BillingInput, PaymentInput, Currency } from "./model";
import type { LedgerPort } from "./port";
import { accountingSchema, createPostgresLedger, migrateAccounting } from "./postgres";
export function balancedJournal(overrides: Partial<Journal> = {}): Journal {
  return { id:"synthetic:j1",commandKey:"synthetic:purchase-1",cardId:"card-a",currency:"ARS",effectiveDate:"2026-01-15",recordedAt:"2026-01-16T12:00:00Z",kind:"purchase",reversesId:null,evidenceIds:["synthetic:e1"],lines:[{accountId:"expense:unallocated",debitMinor:60000,creditMinor:0,purchaseId:null,purposeId:null},{accountId:"card-a:ARS:unbilled",debitMinor:0,creditMinor:60000,purchaseId:null,purposeId:null}],...overrides };
}
export function syntheticSeed(): { accounts: Account[]; cardIds: string[]; evidenceIds: string[] } {
  return {cardIds:["card-a"],evidenceIds:["synthetic:e1"],accounts:[{id:"expense:unallocated",type:"expense",currency:null},{id:"card-a:ARS:unbilled",type:"liability",currency:"ARS"},{id:"card-a:ARS:billed",type:"liability",currency:"ARS"},{id:"card-a:USD:unbilled",type:"liability",currency:"USD"},{id:"card-a:USD:billed",type:"liability",currency:"USD"},{id:"clearing:ARS:unresolved-source",type:"asset",currency:"ARS"},{id:"clearing:USD:unresolved-source",type:"asset",currency:"USD"},{id:"expense:food",type:"expense",currency:null},{id:"expense:travel",type:"expense",currency:null},{id:"equity:opening",type:"equity",currency:null}].map(a=>({...a,parentId:null,labelKey:null,customName:a.id,primaryPurposeId:null,posting:true,enabled:true} as Account))};
}
export async function seedSyntheticLedger(connectionString: string, schema: string): Promise<void> {
  accountingSchema(schema);
  if (!schema.startsWith("acct_test_")) throw new Error("synthetic_seed_requires_test_schema");
  const pool=new Pool({connectionString,connectionTimeoutMillis:5000}); const client=await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(8581401)"); await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query("INSERT INTO cards VALUES('card-a') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO evidence VALUES('synthetic:e1','synthetic','{}') ON CONFLICT DO NOTHING");
    for (const a of syntheticSeed().accounts) await client.query("INSERT INTO accounts(id,type,custom_name,currency,posting,enabled) VALUES($1,$2,$3,$4,true,true) ON CONFLICT DO NOTHING",[a.id,a.type,a.customName,a.currency]);
    await client.query("COMMIT");
  } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();await pool.end();}
}
export async function withTestLedger(work: (port: LedgerPort, context: { connectionString: string; schema: string }) => Promise<void>, options: { seed?: boolean } = {}): Promise<void> {
  const connectionString=process.env.ACCOUNTING_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("missing_ACCOUNTING_TEST_DATABASE_URL");
  const schema=`acct_test_${randomBytes(12).toString("hex")}`;
  const port=createPostgresLedger(connectionString,schema);
  try {await migrateAccounting(connectionString,schema);if(options.seed!==false)await seedSyntheticLedger(connectionString,schema);await work(port,{connectionString,schema});}
  finally {await port.close();const pool=new Pool({connectionString,connectionTimeoutMillis:5000});try {await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);} finally {await pool.end();}}
}

export function purchaseInput(overrides: Partial<PurchaseInput> = {}): PurchaseInput {
 return {key:"purchase-1",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",effectiveDate:"2026-01-15",recordedAt:"2026-01-16T12:00:00Z",evidenceIds:["synthetic:e1"],principalMinor:60000,allocations:[{accountId:"expense:unallocated",purposeId:"unallocated",minor:60000}],...overrides};
}
export function billingInput(overrides: Partial<BillingInput> = {}): BillingInput {
 return {key:"billing-1",purchaseId:"purchase-a",cardId:"card-a",currency:"ARS",installment:1,amountMinor:10000,effectiveDate:"2026-02-01",recordedAt:"2026-02-02T12:00:00Z",evidenceIds:["synthetic:e1"],...overrides};
}
export function paymentInput(overrides: Partial<PaymentInput> = {}): PaymentInput {
 return {key:"payment-1",cardId:"card-a",currency:"ARS",amountMinor:10000,effectiveDate:"2026-02-10",recordedAt:"2026-02-11T12:00:00Z",evidenceIds:["synthetic:e1"],issuerAllocations:null,...overrides};
}
export async function totals(port: LedgerPort,cardId: string,currency: Currency): Promise<{expenseMinor:number;billedMinor:number;unbilledMinor:number;clearingMinor:number}> {
 const result={expenseMinor:0,billedMinor:0,unbilledMinor:0,clearingMinor:0};
 for(const j of await port.journals(cardId)) {if(j.currency!==currency) continue;for(const l of j.lines) {const delta=l.debitMinor-l.creditMinor;if(l.accountId.startsWith("expense:")) result.expenseMinor+=delta;if(l.accountId===`${cardId}:${currency}:billed`) result.billedMinor-=delta;if(l.accountId===`${cardId}:${currency}:unbilled`) result.unbilledMinor-=delta;if(l.accountId===`clearing:${currency}:unresolved-source`) result.clearingMinor+=delta;}}
 return result;
}
