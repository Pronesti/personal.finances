import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/paths";

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS statements (
      id INTEGER PRIMARY KEY,
      file TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL,
      closing_date TEXT NOT NULL,
      cycle_month TEXT NOT NULL,
      due_date TEXT,
      prev_closing_date TEXT,
      balance_ars REAL,
      balance_usd REAL,
      minimum_payment_ars REAL,
      prev_balance_ars REAL,
      limit_purchase REAL,
      rate_tna_pct REAL,
      rate_tem_pct REAL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      date TEXT,
      description TEXT NOT NULL,
      merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      ars REAL,
      usd REAL,
      installment_number INTEGER,
      installment_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tx_statement ON transactions(statement_id);
    CREATE TABLE IF NOT EXISTS upcoming_installments (
      statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount_ars REAL NOT NULL,
      PRIMARY KEY (statement_id, month)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY,
      statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      expected REAL,
      actual REAL
    );
    -- Review state is keyed by stable alert IDENTITY, not by alerts.id, and carries no foreign
    -- key: re-ingesting a statement cascades its alerts rows away, and anomalies have no rows at
    -- all. 'open' is storable so an explicit reopen beats a computed default.
    CREATE TABLE IF NOT EXISTS alert_reviews (
      key TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('open','reviewed','dismissed'))
    );
  `);
  // CREATE IF NOT EXISTS never widens an existing table, so a database created before the
  // bank-terms columns existed gets them here. Values stay NULL until the next ingest.
  const have = new Set(
    (db.prepare("PRAGMA table_info(statements)").all() as { name: string }[]).map(c => c.name)
  );
  for (const col of ["prev_balance_ars", "limit_purchase", "rate_tna_pct", "rate_tem_pct"]) {
    if (!have.has(col)) db.exec(`ALTER TABLE statements ADD COLUMN ${col} REAL`);
  }
}

export function openDb(dbPath: string = path.join(DATA_DIR, "app.db")): Database.Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

// Page-side singleton: one connection per server process (survives HMR via globalThis).
const g = globalThis as unknown as { __db?: Database.Database };
export function getDb(): Database.Database {
  return (g.__db ??= openDb());
}
