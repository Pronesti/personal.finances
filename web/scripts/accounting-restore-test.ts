/** Read-only recovery proof. Never migrates, repairs or writes the selected database. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export type RecoverySnapshot = {
  version: 1; migrations: number[];
  tables: Record<string, { count: number; sha256: string }>;
  accountTotals: unknown[]; cardTotals: unknown[]; componentTotals: unknown[]; openingTotals: unknown[];
  objects: Record<string, { size: number; sha256: string }>;
  files: Record<string, { size: number; sha256: string }>;
  guards: unknown[]; errors: string[];
};
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function compareRecovery(expected: RecoverySnapshot, actual: RecoverySnapshot): string[] {
  const differences = [...actual.errors];
  for (const key of ["version", "migrations", "tables", "accountTotals", "cardTotals", "componentTotals", "openingTotals", "objects", "files", "guards"] as const) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) differences.push(`recovery_mismatch:${key}`);
  }
  if (expected.errors.length) differences.push("baseline_invalid");
  return differences;
}
function privateRoot(root: string): string {
  if (!path.isAbsolute(root) || fs.realpathSync(root) !== path.resolve(root)) throw new Error("unsafe_storage_root");
  const st = fs.lstatSync(root);
  if (!st.isDirectory() || (st.mode & 0o077)) throw new Error("unsafe_storage_root");
  return root;
}
function inventory(root: string, prefix: string, output: RecoverySnapshot["files"]): void {
  for (const name of fs.readdirSync(root).sort()) {
    const file = path.join(root, name), key = `${prefix}${name}`, st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw new Error("linked_storage_entry");
    if (st.isDirectory()) inventory(file, key + "/", output);
    else if (st.isFile()) output[key] = { size: st.size, sha256: hash(fs.readFileSync(file)) };
    else throw new Error("special_storage_entry");
  }
}
export async function checkRecovery(input: { databaseUrl: string; documentRoot: string; referenceRoot: string }): Promise<RecoverySnapshot> {
  privateRoot(input.documentRoot); privateRoot(input.referenceRoot);
  const docs = path.resolve(input.documentRoot), refs = path.resolve(input.referenceRoot);
  if (docs === refs || docs.startsWith(refs + path.sep) || refs.startsWith(docs + path.sep)) throw new Error("storage_roots_overlap");
  const result: RecoverySnapshot = { version: 1, migrations: [], tables: {}, accountTotals: [], cardTotals: [], componentTotals: [], openingTotals: [], objects: {}, files: {}, guards: [], errors: [] };
  inventory(docs, "documents/", result.files); inventory(refs, "references/", result.files);
  const pool = new Pool({ connectionString: input.databaseUrl, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL search_path = accounting, pg_catalog");
    result.migrations = (await client.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map(r => r.version);
    const installed = fs.readdirSync(path.resolve(import.meta.dirname, "../src/lib/accounting/migrations")).filter(n => /^\d+.*\.sql$/.test(n)).map(n => Number(n.split("-")[0])).sort((a,b) => a-b);
    if (JSON.stringify(installed) !== JSON.stringify(result.migrations)) result.errors.push("migration_versions_mismatch");
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='accounting' ORDER BY tablename")).rows;
    for (const { tablename } of tables) {
      if (!/^[a-z_]+$/.test(tablename)) throw new Error("unsafe_table_name");
      const rows = (await client.query(`SELECT to_jsonb(t)::text AS value FROM accounting."${tablename}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows;
      result.tables[tablename] = { count: rows.length, sha256: hash(rows.map(r => r.value).join("\n")) };
    }
    const invariants: Record<string, string> = {
      journals_invalid: "SELECT j.id FROM journals j LEFT JOIN journal_lines l ON l.journal_id=j.id GROUP BY j.id HAVING j.status<>'posted' OR count(l.ordinal)<2 OR coalesce(sum(l.debit_minor),0)<>coalesce(sum(l.credit_minor),0) OR coalesce(sum(l.debit_minor),0)<=0",
      journal_evidence_missing: "SELECT id FROM journals j WHERE NOT EXISTS(SELECT 1 FROM journal_evidence e WHERE e.journal_id=j.id)",
      posting_account_invalid: "SELECT l.journal_id FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE NOT a.posting OR a.currency IS NOT NULL AND a.currency<>j.currency OR EXISTS(SELECT 1 FROM accounts c WHERE c.parent_id=a.id)",
      account_parent_invalid: "SELECT a.id FROM accounts a JOIN accounts p ON p.id=a.parent_id WHERE a.type<>p.type",
      source_revision_fork: "SELECT previous_revision_id FROM source_revisions WHERE previous_revision_id IS NOT NULL GROUP BY previous_revision_id HAVING count(*)>1",
      correction_invalid: "SELECT c.id FROM correction_links c JOIN journals r ON r.id=c.reversal_journal_id JOIN journals n ON n.id=c.replacement_journal_id WHERE c.to_version<>c.from_version+1 OR r.kind<>'reversal' OR n.kind<>'replacement' OR r.reverses_id IS NULL",
      receipt_link_fork: "SELECT previous_decision_id FROM receipt_link_decisions WHERE previous_decision_id IS NOT NULL GROUP BY previous_decision_id HAVING count(*)>1",
      receipt_current_duplicate_purchase: "SELECT purchase_id FROM receipt_link_decisions d WHERE action='link' AND NOT EXISTS(SELECT 1 FROM receipt_link_decisions c WHERE c.previous_decision_id=d.id) GROUP BY purchase_id HAVING count(*)>1",
      payment_attribution_invalid: "SELECT p.id FROM payments p WHERE p.amount_minor <> coalesce((SELECT sum(a.minor) FROM attributions a WHERE a.payment_id=p.id AND a.revision=coalesce((SELECT max(r.revision) FROM attribution_revisions r WHERE r.payment_id=p.id),1)),0)+coalesce((SELECT r.unapplied_minor FROM attribution_revisions r WHERE r.payment_id=p.id ORDER BY r.revision DESC LIMIT 1),(p.payload->>'unappliedMinor')::bigint)",
      source_clearing_invalid: "WITH expected AS (SELECT currency,sum(amount_minor) amount FROM payments GROUP BY currency),actual AS (SELECT j.currency,sum(l.credit_minor-l.debit_minor) amount FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.status='posted' AND l.account_id='clearing:'||j.currency||':unresolved-source' GROUP BY j.currency) SELECT coalesce(e.currency,a.currency) FROM expected e FULL JOIN actual a USING(currency) WHERE coalesce(e.amount,0)<>coalesce(a.amount,0)",
      source_object_unreferenced: "SELECT sha256 FROM source_documents d WHERE NOT EXISTS(SELECT 1 FROM source_revisions r WHERE r.document_hash=d.sha256 OR r.raw_object_hash=d.sha256) AND NOT EXISTS(SELECT 1 FROM receipt_facts r WHERE r.original_rows_hash=d.sha256 OR r.corrected_rows_hash=d.sha256)",
    };
    for (const [code, sql] of Object.entries(invariants)) if ((await client.query(sql)).rowCount) result.errors.push(code);
    result.accountTotals = (await client.query("SELECT l.account_id,j.currency,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.status='posted' GROUP BY l.account_id,j.currency ORDER BY l.account_id,j.currency")).rows;
    result.cardTotals = (await client.query("SELECT j.card_id,j.currency,l.account_id,sum(l.debit_minor-l.credit_minor)::text net FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.status='posted' GROUP BY j.card_id,j.currency,l.account_id ORDER BY j.card_id,j.currency,l.account_id")).rows;
    result.componentTotals = (await client.query("SELECT b.card_id,b.currency,sum(coalesce((SELECT r.minor FROM component_revisions r WHERE r.component_id=c.id ORDER BY r.revision DESC LIMIT 1),c.minor))::text minor FROM billed_components c JOIN billings b ON b.id=c.billing_id GROUP BY b.card_id,b.currency ORDER BY b.card_id,b.currency")).rows;
    result.guards = (await client.query("SELECT c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='accounting' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
    const guarded = new Set((result.guards as {table_name:string;enabled:string}[]).filter(t => t.enabled === "O" || t.enabled === "A").map(t => t.table_name));
    for (const name of ["journals", "journal_lines", "journal_evidence", "commands", "evidence", "source_documents", "source_revisions", "source_lines", "purchase_versions", "correction_links", "component_revisions", "review_decisions", "receipt_facts", "receipt_link_decisions"]) if (!guarded.has(name)) result.errors.push(`immutability_guard_missing:${name}`);
    for (const row of (await client.query("SELECT sha256,relative_path,byte_length::text FROM source_documents ORDER BY sha256")).rows) {
      if (row.relative_path !== row.sha256 || !/^[a-f0-9]{64}$/.test(row.sha256)) { result.errors.push("object_path_invalid"); continue; }
      const file = result.files[`documents/objects/${row.relative_path}`];
      if (!file || file.sha256 !== row.sha256 || String(file.size) !== row.byte_length) result.errors.push("source_object_missing_or_corrupt");
      else result.objects[row.sha256] = file;
    }
    if (result.tables.legacy_objects) {
      for (const row of (await client.query("SELECT object_path,sha256,byte_length::text FROM legacy_objects ORDER BY run_id,source_path")).rows) {
        if (!/^[a-f0-9]{64}$/.test(row.object_path)) { result.errors.push("legacy_object_path_invalid"); continue; }
        const file = result.files[`documents/objects/${row.object_path}`];
        if (!file || file.sha256 !== row.sha256 || String(file.size) !== row.byte_length) result.errors.push("legacy_object_missing_or_corrupt");
        else result.objects[row.sha256] = file;
      }
    }
    for (const file of Object.keys(result.files)) {
      if (file.startsWith("documents/objects/") && !result.objects[file.slice("documents/objects/".length)]) result.errors.push("source_object_orphan");
    }
    if (result.tables.opening_obligations) {
      const openingChecks: Record<string, string> = {
        opening_obligation_invalid: "SELECT o.id FROM opening_obligations o JOIN journals j ON j.id=o.opening_journal_id WHERE NOT (o.payload ?& ARRAY['id','cardId','currency','openingJournalId','originalPrincipalMinor','alreadyBilledMinor','remainingMinor','purchaseDate','lastBilledInstallment','installmentCount','allocations','evidenceIds']) OR j.kind<>'opening' OR j.card_id<>o.card_id OR j.currency<>o.currency OR o.payload->>'id'<>o.id OR o.payload->>'cardId'<>o.card_id OR o.payload->>'currency'<>o.currency OR o.payload->>'openingJournalId'<>o.opening_journal_id OR (o.payload->>'remainingMinor')::numeric<=0 OR (o.payload->>'originalPrincipalMinor')::numeric<>(o.payload->>'alreadyBilledMinor')::numeric+(o.payload->>'remainingMinor')::numeric OR (o.payload->>'alreadyBilledMinor')::numeric<0 OR (o.payload->>'purchaseDate')::date>j.effective_date OR (o.payload->>'lastBilledInstallment')::integer<0 OR (o.payload->>'installmentCount')::integer<=(o.payload->>'lastBilledInstallment')::integer OR coalesce((SELECT sum((a->>'minor')::numeric) FROM jsonb_array_elements(o.payload->'allocations') a),0)<>(o.payload->>'remainingMinor')::numeric",
        opening_proof_evidence_invalid: "SELECT o.id FROM opening_obligations o WHERE jsonb_array_length(o.payload->'evidenceIds')=0 OR ARRAY(SELECT e.evidence_id FROM opening_obligation_evidence e WHERE e.obligation_id=o.id ORDER BY e.evidence_id)<>ARRAY(SELECT value FROM jsonb_array_elements_text(o.payload->'evidenceIds') ORDER BY value) OR EXISTS(SELECT 1 FROM opening_obligation_evidence e LEFT JOIN evidence proof ON proof.id=e.evidence_id WHERE e.obligation_id=o.id AND proof.id IS NULL)",
        opening_capacity_invalid: "SELECT o.opening_journal_id FROM opening_obligations o GROUP BY o.opening_journal_id,o.card_id,o.currency HAVING sum((o.payload->>'remainingMinor')::numeric)>coalesce((SELECT sum(l.credit_minor-l.debit_minor) FROM journal_lines l WHERE l.journal_id=o.opening_journal_id AND l.account_id=o.card_id||':'||o.currency||':unbilled'),0)",
        opening_overbilled: "SELECT o.id FROM opening_obligations o WHERE coalesce((SELECT sum(b.amount_minor) FROM billings b WHERE b.opening_obligation_id=o.id),0)>(o.payload->>'remainingMinor')::numeric",
        opening_future_billing_invalid: "SELECT b.id FROM billings b JOIN opening_obligations o ON o.id=b.opening_obligation_id JOIN journals j ON j.id=b.journal_id JOIN journals initial ON initial.id=o.opening_journal_id WHERE b.purchase_id IS NOT NULL OR b.card_id<>o.card_id OR b.currency<>o.currency OR j.kind<>'billing' OR j.effective_date<=initial.effective_date OR b.installment<=(o.payload->>'lastBilledInstallment')::integer OR b.installment>(o.payload->>'installmentCount')::integer OR b.payload->>'origin'<>'opening_installment' OR EXISTS(SELECT 1 FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id NOT IN (o.card_id||':'||o.currency||':unbilled',o.card_id||':'||o.currency||':billed')) OR coalesce((SELECT sum(l.debit_minor-l.credit_minor) FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id=o.card_id||':'||o.currency||':unbilled'),0)<>b.amount_minor OR coalesce((SELECT sum(l.credit_minor-l.debit_minor) FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id=o.card_id||':'||o.currency||':billed'),0)<>b.amount_minor",
        opening_balance_billing_invalid: "SELECT b.id FROM billings b JOIN journals j ON j.id=b.journal_id WHERE b.purchase_id IS NULL AND b.opening_obligation_id IS NULL AND (b.payload->>'origin' IS DISTINCT FROM 'opening_balance' OR j.kind<>'opening' OR b.card_id<>j.card_id OR b.currency<>j.currency OR coalesce((SELECT sum(l.credit_minor-l.debit_minor) FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id=b.card_id||':'||b.currency||':billed'),0)<>b.amount_minor OR EXISTS(SELECT 1 FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=j.id AND a.type IN ('expense','income')) OR coalesce((SELECT sum(c.minor) FROM billed_components c WHERE c.billing_id=b.id),0)<>b.amount_minor)",
      };
      for (const [code, sql] of Object.entries(openingChecks)) if ((await client.query(sql)).rowCount) result.errors.push(code);
      const fks = (await client.query("SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='accounting' AND c.contype='f' AND c.convalidated AND c.conname IN ('opening_obligations_card_id_fkey','opening_obligations_opening_journal_id_fkey','opening_obligation_evidence_obligation_id_fkey','opening_obligation_evidence_evidence_id_fkey','billings_opening_obligation_id_fkey')")).rows;
      if (fks.length !== 5) result.errors.push("opening_proof_foreign_keys_missing");
      for (const name of ["opening_obligations", "opening_obligation_evidence"]) if (!guarded.has(name)) result.errors.push(`immutability_guard_missing:${name}`);
      result.openingTotals = (await client.query("SELECT o.id,o.card_id,o.currency,o.payload->>'originalPrincipalMinor' original_principal,o.payload->>'alreadyBilledMinor' already_billed,o.payload->>'remainingMinor' supported_remaining,coalesce(sum(b.amount_minor),0)::text future_billed,((o.payload->>'remainingMinor')::numeric-coalesce(sum(b.amount_minor),0))::text current_remaining FROM opening_obligations o LEFT JOIN billings b ON b.opening_obligation_id=o.id GROUP BY o.id ORDER BY o.id")).rows;
    }
    // Stable insertion order also when a legacy object shares an admitted evidence hash.
    result.objects = Object.fromEntries(Object.entries(result.objects).sort(([a],[b]) => a.localeCompare(b)));
    await client.query("COMMIT");
    return result;
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); await pool.end(); }
}
async function main() {
  const args = process.argv.slice(2);
  const get = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i+1] || args[i+1].startsWith("--")) throw new Error("explicit_arguments_required"); return args[i+1]; };
  const databaseUrl = process.env.ACCOUNTING_RESTORE_DATABASE_URL;
  if (!databaseUrl) throw new Error("explicit_restore_database_required");
  const report = await checkRecovery({ databaseUrl, documentRoot: get("--document-root"), referenceRoot: get("--reference-root") });
  const baseline = args.includes("--baseline") ? JSON.parse(fs.readFileSync(get("--baseline"), "utf8")) as RecoverySnapshot : null;
  const errors = baseline ? compareRecovery(baseline, report) : report.errors;
  fs.writeFileSync(get("--output"), JSON.stringify({ ...report, errors }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Recovery check: ${Object.keys(report.tables).length} tables, ${Object.keys(report.objects).length} objects, ${errors.length} errors`);
  if (errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error("Recovery check failed; candidate remains offline"); process.exitCode = 1; });
