import path from "node:path";
import type Database from "better-sqlite3";
import { AccountingError } from "./accounting/model";
import { createPostgresLedger } from "./accounting/postgres";
import { createPostgresReader } from "./accounting/reader-postgres";
import { createLocalDocuments, type DocumentStore } from "./accounting/documents";
import type { LedgerPort } from "./accounting/port";
import { reportMonths } from "./accounting/report-months";
import type { AccountingReader, ReportFact } from "./accounting/read-model";

export const POSTGRES_READY_PAGES: ReadonlySet<string> = new Set([
  "chrome", "/accounting", "/accounting/settings",
  "/", "/trends", "/categories", "/merchants", "/movers", "/compare", "/sankey",
  "/calendar", "/habits", "/pace", "/currency", "/recurring", "/inflation", "/taxes",
  "/credits", "/float", "/installments", "/future", "/bank", "/anomalies",
  "/receipts", "/receipts/[id]", "/super", "/super/products", "/super/categories",
  "/super/charges", "/super/review", "/review", "/upload",
]);

export function selectedBackend(env: Record<string, string | undefined> = process.env): "sqlite" | "postgres" {
  const backend = env.TARJETAS_BACKEND ?? "sqlite";
  if (backend !== "sqlite" && backend !== "postgres") throw new AccountingError("invalid_backend");
  return backend;
}

export type AccountingContext = {
  ledger: LedgerPort & { close(): Promise<void> };
  reader: AccountingReader;
  documents: DocumentStore;
  documentRoot: string;
  appRevision: string | undefined;
};
export type PageBackend =
  | { kind: "sqlite"; db: Database.Database; close(): Promise<void> }
  | ({ kind: "postgres"; facts: ReportFact[]; close(): Promise<void> } & AccountingContext)
  | { kind: "unavailable"; code: "accounting_page_not_ready"; close(): Promise<void> };

function accountingContext(): AccountingContext {
  const url = process.env.TARJETAS_DATABASE_URL;
  const root = process.env.TARJETAS_DOCUMENT_ROOT;
  if (!url) throw new AccountingError("database_unconfigured");
  if (!root || !path.isAbsolute(root)) throw new AccountingError("document_root_unconfigured");
  return {
    ledger: createPostgresLedger(url), reader: createPostgresReader(url),
    documents: createLocalDocuments(path.join(root, "objects")), documentRoot: root,
    appRevision: process.env.ACCOUNTING_APP_REVISION,
  };
}

/** One explicit source per request. Unsupported trial pages never consult SQLite. */
export async function backendForPage(page: string): Promise<PageBackend> {
  if (selectedBackend() === "sqlite") {
    const { getDb } = await import("./db");
    return { kind: "sqlite", db: getDb(), close: async () => {} };
  }
  if (!POSTGRES_READY_PAGES.has(page)) {
    return { kind: "unavailable", code: "accounting_page_not_ready", close: async () => {} };
  }
  const context = accountingContext();
  const close = async () => { await Promise.all([context.reader.close(), context.ledger.close()]); };
  try {
    return { ...context, kind: "postgres", facts: await context.reader.facts(), close };
  } catch (error) { await close(); throw error; }
}

/** Mutating adapters use this only after selecting the PostgreSQL path explicitly. */
export async function withAccounting<T>(work: (context: AccountingContext) => Promise<T>): Promise<T> {
  if (selectedBackend() !== "postgres") throw new AccountingError("accounting_backend_required");
  const context = accountingContext();
  try { return await work(context); }
  finally { await Promise.all([context.reader.close(), context.ledger.close()]); }
}

export async function accountingChrome(): Promise<{ months: string[]; latestClosing: string | null }> {
  return withAccounting(async ({ reader }) => {
    const statements = await reader.statements();
    return {
      months: reportMonths(await reader.facts(), statements),
      latestClosing: statements.map(statement => statement.closingDate).sort().at(-1) ?? null,
    };
  });
}
