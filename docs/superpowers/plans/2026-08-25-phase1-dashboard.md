# Phase 1 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local Next.js + SQLite dashboard over the 27 statement JSONs: ELI5 one-screen summary + charts 1 (stacked area), 5 (category drill), 6 (recurring table), 7 (period comparison), with real-terms (CPI-adjusted) default.

**Architecture:** Next.js App Router app in `web/`. A TypeScript ingest CLI reads `json/*.json` into SQLite (`data/app.db`) with normalized merchants + rule-based categories. Server components query SQLite directly via a pure query layer; Recharts client components render. Value mode (nominal/real) and spend mode (cash/accrual) travel as URL search params.

**Tech Stack:** Next.js 15 (App Router, TS), better-sqlite3, Recharts, Tailwind, vitest, tsx.

**Spec:** `docs/analysis.md` (sections 1–7, 10). Research context: `docs/research-financial-apps.md`.

## Global Constraints

- All lib code in `web/src/lib/`, one responsibility per file. Pure functions take data in, return data out — DB touched only in `db.ts` and `queries.ts`.
- Default value mode: **real** (constant pesos, latest CPI month as base). Toggle to nominal. (spec §1, §6)
- Two spend modes everywhere: `cash` (as billed) and `accrual` (cuota 1/N expanded to full price at purchase date, cuotas 2..N excluded). Default **accrual** on spend views. (spec §3)
- Amounts, dates, account numbers never leave the machine — Phase 1 has zero LLM calls; categorization is rules-only. (spec §1, §7)
- ARS aggregates only in Phase 1 charts; USD amounts shown raw in drill lists. Dual-currency chart is Phase 2.
- Transactions sections in data: `payments`, `purchases`, `taxes_and_charges`. Spend = `purchases` only; `taxes_and_charges` categorized `taxes_fees` and included only when a view says tax-inclusive.
- UI copy in English; merchant/category names as-is. (interview Q16)
- Money display: `Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0})`.
- Node ≥ 20. DB file `data/app.db` is gitignored; `data/*.json` seed/cache files are committed.
- Commit after every task (already in steps). Repo root is the git root; the Next app lives in `web/`.

---

### Task 1: Scaffold `web/` app + test runner

**Files:**
- Create: `web/` (via create-next-app), `web/vitest.config.ts`
- Modify: `.gitignore`, `web/next.config.ts`, `web/package.json` (scripts)

**Interfaces:**
- Produces: working `npm run dev`, `npm test` (vitest), path alias `@/` → `web/src/`.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/user/Desktop/Tarjetas
npx create-next-app@latest web --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-npm --yes
cd web && npm i better-sqlite3 recharts && npm i -D vitest tsx @types/better-sqlite3
```

- [ ] **Step 2: Configure**

`web/next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["better-sqlite3"] };
export default nextConfig;
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

Add to `web/package.json` scripts: `"test": "vitest run", "ingest": "tsx scripts/ingest.ts", "fetch-ipc": "tsx scripts/fetch-ipc.ts"`.

Append to root `.gitignore`:
```
node_modules/
web/.next/
data/app.db
```

- [ ] **Step 3: Verify**

Run: `cd web && npm test` → "no test files found" exit 0 (or trivial pass); `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js app with vitest"
```

---

### Task 2: SQLite schema + connection (`db.ts`)

**Files:**
- Create: `web/src/lib/db.ts`
- Test: `web/src/lib/db.test.ts`

**Interfaces:**
- Produces: `openDb(path?: string): Database.Database` (defaults to `<repo>/data/app.db`, creates dir, runs `migrate`); `migrate(db): void`. Tables: `statements`, `transactions`, `installments_upcoming` (columns below — later tasks depend on these exact names).

- [ ] **Step 1: Write the failing test**

`web/src/lib/db.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";

describe("db", () => {
  it("creates schema and accepts rows", () => {
    const db = openDb(":memory:");
    const s = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars, raw)
       VALUES ('visa_x.json','visa','2026-07-30','2026-08-07','2026-07-02',100,1,10,'{}')`
    ).run();
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', '2026-07-10', 'MERPAGO*X', 'X', 'other', NULL, 50, NULL, 1, 6)`
    ).run(s.lastInsertRowid);
    db.prepare(`INSERT INTO installments_upcoming (statement_id, month, amount_ars) VALUES (?, '2026-08', 375290.39)`)
      .run(s.lastInsertRowid);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 1 });
  });

  it("statement file is unique", () => {
    const db = openDb(":memory:");
    const ins = db.prepare(`INSERT INTO statements (file, brand, closing_date, raw) VALUES ('a.json','visa','2026-01-29','{}')`);
    ins.run();
    expect(() => ins.run()).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`web/src/lib/db.ts`:
```ts
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_PATH = path.resolve(process.cwd(), "..", "data", "app.db");

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS statements (
      id INTEGER PRIMARY KEY,
      file TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL,
      closing_date TEXT NOT NULL,
      due_date TEXT,
      prev_closing_date TEXT,
      balance_ars REAL,
      balance_usd REAL,
      minimum_payment_ars REAL,
      raw TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant);
    CREATE TABLE IF NOT EXISTS installments_upcoming (
      statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount_ars REAL NOT NULL
    );
  `);
}

export function openDb(dbPath: string = DEFAULT_PATH): Database.Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db.ts web/src/lib/db.test.ts && git commit -m "feat: sqlite schema and connection"
```

---

### Task 3: Merchant normalization + rule categorization (`categorize.ts`)

**Files:**
- Create: `web/src/lib/categorize.ts`, `data/merchant-categories.json`
- Test: `web/src/lib/categorize.test.ts`

**Interfaces:**
- Produces: `normalizeMerchant(description: string): string`; `categorize(description: string, section: string, rules: Rule[]): { category: string; subcategory: string | null }`; `type Rule = { match: string; category: string; subcategory?: string }`; `loadRules(): Rule[]` (reads `data/merchant-categories.json`). Categories (spec §3): `food, transport, subscriptions, health, entertainment, shopping, services, travel, education, taxes_fees, transfers, other`.

- [ ] **Step 1: Write the failing test**

`web/src/lib/categorize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeMerchant, categorize } from "@/lib/categorize";

const rules = [
  { match: "OSDE", category: "health", subcategory: "insurance" },
  { match: "SPOTIFY", category: "subscriptions", subcategory: "music" },
  { match: "PEDIDOSYA", category: "food", subcategory: "delivery" },
];

describe("normalizeMerchant", () => {
  it("strips marketplace prefixes, voucher tails, USD tails, and uppercases", () => {
    expect(normalizeMerchant("MERPAGO*TIENDANEWSAN")).toBe("TIENDANEWSAN");
    expect(normalizeMerchant("DLO*PEDIDOSYA PLUS")).toBe("PEDIDOSYA PLUS");
    expect(normalizeMerchant("OSDE 000012345678901")).toBe("OSDE");
    expect(normalizeMerchant("Spotify USD 3,73")).toBe("SPOTIFY");
    expect(normalizeMerchant("APPLE.COM/BILL MT8ZSVB45USD 9,99")).toBe("APPLE.COM/BILL");
    expect(normalizeMerchant("106851*MOVISTAR AREN")).toBe("MOVISTAR AREN");
  });
});

describe("categorize", () => {
  it("matches rules on normalized merchant", () => {
    expect(categorize("DLO*PEDIDOSYA PLUS", "purchases", rules))
      .toEqual({ category: "food", subcategory: "delivery" });
    expect(categorize("OSDE 000012345678901", "purchases", rules))
      .toEqual({ category: "health", subcategory: "insurance" });
  });
  it("taxes_and_charges section is always taxes_fees", () => {
    expect(categorize("IVA RG 4240 21%( 37759,04)", "taxes_and_charges", rules))
      .toEqual({ category: "taxes_fees", subcategory: null });
  });
  it("unknown merchant falls back to other", () => {
    expect(categorize("XYZ RANDOM SHOP", "purchases", rules))
      .toEqual({ category: "other", subcategory: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/categorize.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/categorize.ts`:
```ts
import fs from "node:fs";
import path from "node:path";

export type Rule = { match: string; category: string; subcategory?: string };

const PREFIX_RE = /^(MERPAGO|MERCADOPAGO|DLO|PAYU|EBANX|\d+)\*/i;
const USD_TAIL_RE = /\s*\S*USD\s*[\d.,]+$/i;   // "USD 3,73" and glued "MT8ZSVB45USD 9,99"
const NUM_TAIL_RE = /\s+\d{6,}$/;              // long voucher/account tails

export function normalizeMerchant(description: string): string {
  let s = description.trim().replace(PREFIX_RE, "");
  s = s.replace(USD_TAIL_RE, "");
  s = s.replace(NUM_TAIL_RE, "");
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

export function loadRules(): Rule[] {
  const p = path.resolve(process.cwd(), "..", "data", "merchant-categories.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).rules as Rule[];
}

export function categorize(
  description: string,
  section: string,
  rules: Rule[]
): { category: string; subcategory: string | null } {
  if (section === "taxes_and_charges") return { category: "taxes_fees", subcategory: null };
  const m = normalizeMerchant(description);
  for (const r of rules) {
    if (m.includes(r.match.toUpperCase())) {
      return { category: r.category, subcategory: r.subcategory ?? null };
    }
  }
  return { category: "other", subcategory: null };
}
```

`data/merchant-categories.json` (seed — grows over time; manual overrides live here too, spec §7):
```json
{
  "rules": [
    { "match": "SPOTIFY", "category": "subscriptions", "subcategory": "music" },
    { "match": "HBOMAX", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "PRIMEVIDEO", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "YOUTUBEPREMIUM", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "APPLE.COM/BILL", "category": "subscriptions", "subcategory": "apps" },
    { "match": "PEDIDOSYA", "category": "food", "subcategory": "delivery" },
    { "match": "RAPPI", "category": "food", "subcategory": "delivery" },
    { "match": "OSDE", "category": "health", "subcategory": "insurance" },
    { "match": "FARMACIA", "category": "health", "subcategory": "pharmacy" },
    { "match": "FARMACITY", "category": "health", "subcategory": "pharmacy" },
    { "match": "MOVISTAR", "category": "services", "subcategory": "phone" },
    { "match": "PERSONAL", "category": "services", "subcategory": "phone" },
    { "match": "CLARO", "category": "services", "subcategory": "phone" },
    { "match": "CLUB ATLETICO BO", "category": "entertainment", "subcategory": "sports" },
    { "match": "CUOTA XENEIZE", "category": "entertainment", "subcategory": "sports" },
    { "match": "SHELL", "category": "transport", "subcategory": "fuel" },
    { "match": "YPF", "category": "transport", "subcategory": "fuel" },
    { "match": "UBER", "category": "transport", "subcategory": "rideshare" },
    { "match": "CABIFY", "category": "transport", "subcategory": "rideshare" },
    { "match": "COTO", "category": "food", "subcategory": "supermarket" },
    { "match": "CARREFOUR", "category": "food", "subcategory": "supermarket" },
    { "match": "DIA ", "category": "food", "subcategory": "supermarket" },
    { "match": "JUMBO", "category": "food", "subcategory": "supermarket" },
    { "match": "HOTEL", "category": "travel", "subcategory": "lodging" },
    { "match": "AEROLINEAS", "category": "travel", "subcategory": "flights" },
    { "match": "DESPEGAR", "category": "travel", "subcategory": "flights" },
    { "match": "TIENDANEWSAN", "category": "shopping", "subcategory": "electronics" },
    { "match": "WHIRLPOOL", "category": "shopping", "subcategory": "appliances" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/categorize.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/categorize.ts web/src/lib/categorize.test.ts data/merchant-categories.json
git commit -m "feat: merchant normalization and rule-based categorization"
```

---

### Task 4: Ingest CLI (`statementToRows` + `scripts/ingest.ts`)

**Files:**
- Create: `web/src/lib/ingest.ts`, `web/scripts/ingest.ts`
- Test: `web/src/lib/ingest.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 2), `categorize`/`normalizeMerchant`/`loadRules` (Task 3).
- Produces: `statementToRows(json: StatementJson, rules: Rule[]): { statement: StatementRow; transactions: TxRow[]; installments: { month: string; amount_ars: number }[] }`; `ingestFile(db, json, rules): void` (upsert by `file`: delete+reinsert so re-runs are idempotent); CLI `npm run ingest` loops `../json/*.json`.

- [ ] **Step 1: Write the failing test**

`web/src/lib/ingest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { statementToRows, ingestFile } from "@/lib/ingest";
import { openDb } from "@/lib/db";

const rules = [{ match: "OSDE", category: "health", subcategory: "insurance" }];

const fixture = {
  file: "visa_2026_07_30.pdf",
  brand: "visa",
  period: { closing_date: "2026-07-30", due_date: "2026-08-07", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 2430781.57, current_usd: 32.32, minimum_payment_ars: 280310.0 },
  upcoming_installments: [{ month: "2026-08", amount_ars: 375290.39 }],
  transactions: [
    { section: "payments", date: "2026-07-13", description: "SU PAGO EN PESOS", ars: -3864892.39, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", date: "2026-07-10", description: "OSDE 000012345678901", ars: 120000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", date: "2026-07-11", description: "MERPAGO*TIENDANEWSAN", ars: 50000, usd: null, installment_number: 13, installment_count: 18 },
    { section: "taxes_and_charges", date: null, description: "IVA RG 4240 21%( 37759,04)", ars: 7929.39, usd: null, installment_number: null, installment_count: null },
  ],
} as any;

describe("statementToRows", () => {
  it("maps statement, categorizes tx, keeps installments", () => {
    const r = statementToRows(fixture, rules);
    expect(r.statement).toMatchObject({ file: "visa_2026_07_30.pdf", brand: "visa", closing_date: "2026-07-30" });
    expect(r.transactions).toHaveLength(4);
    const osde = r.transactions.find(t => t.description.startsWith("OSDE"))!;
    expect(osde).toMatchObject({ merchant: "OSDE", category: "health", subcategory: "insurance" });
    const iva = r.transactions.find(t => t.section === "taxes_and_charges")!;
    expect(iva.category).toBe("taxes_fees");
    expect(r.installments).toEqual([{ month: "2026-08", amount_ars: 375290.39 }]);
  });
});

describe("ingestFile", () => {
  it("is idempotent per file", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules);
    ingestFile(db, fixture, rules);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 4 });
    expect(db.prepare("SELECT COUNT(*) n FROM installments_upcoming").get()).toEqual({ n: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/ingest.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/ingest.ts`:
```ts
import type Database from "better-sqlite3";
import { categorize, normalizeMerchant, type Rule } from "@/lib/categorize";

export type StatementJson = {
  file: string;
  brand: string;
  period: { closing_date: string; due_date?: string; previous_closing_date?: string };
  balances?: { current_ars?: number; current_usd?: number; minimum_payment_ars?: number };
  upcoming_installments?: { month: string; amount_ars: number }[];
  transactions: {
    section: string; date: string | null; description: string;
    ars: number | null; usd: number | null;
    installment_number: number | null; installment_count: number | null;
  }[];
};

export function statementToRows(json: StatementJson, rules: Rule[]) {
  const statement = {
    file: json.file,
    brand: json.brand,
    closing_date: json.period.closing_date,
    due_date: json.period.due_date ?? null,
    prev_closing_date: json.period.previous_closing_date ?? null,
    balance_ars: json.balances?.current_ars ?? null,
    balance_usd: json.balances?.current_usd ?? null,
    minimum_payment_ars: json.balances?.minimum_payment_ars ?? null,
    raw: JSON.stringify(json),
  };
  const transactions = json.transactions.map(t => {
    const { category, subcategory } = categorize(t.description, t.section, rules);
    return {
      section: t.section,
      date: t.date,
      description: t.description,
      merchant: normalizeMerchant(t.description),
      category, subcategory,
      ars: t.ars, usd: t.usd,
      installment_number: t.installment_number,
      installment_count: t.installment_count,
    };
  });
  const installments = (json.upcoming_installments ?? []).map(i => ({ month: i.month, amount_ars: i.amount_ars }));
  return { statement, transactions, installments };
}

export function ingestFile(db: Database.Database, json: StatementJson, rules: Rule[]): void {
  const { statement, transactions, installments } = statementToRows(json, rules);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM statements WHERE file = ?").run(statement.file);
    const sid = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars, raw)
       VALUES (@file, @brand, @closing_date, @due_date, @prev_closing_date, @balance_ars, @balance_usd, @minimum_payment_ars, @raw)`
    ).run(statement).lastInsertRowid;
    const insTx = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, @section, @date, @description, @merchant, @category, @subcategory, @ars, @usd, @installment_number, @installment_count)`
    );
    for (const t of transactions) insTx.run(sid, t);
    const insUp = db.prepare("INSERT INTO installments_upcoming (statement_id, month, amount_ars) VALUES (?, ?, ?)");
    for (const i of installments) insUp.run(sid, i.month, i.amount_ars);
  });
  run();
}
```

`web/scripts/ingest.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/lib/db";
import { loadRules } from "../src/lib/categorize";
import { ingestFile } from "../src/lib/ingest";

const jsonDir = path.resolve(process.cwd(), "..", "json");
const db = openDb();
const rules = loadRules();
const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json")).sort();
for (const f of files) {
  ingestFile(db, JSON.parse(fs.readFileSync(path.join(jsonDir, f), "utf8")), rules);
  console.log("ingested", f);
}
console.log("done:", files.length, "statements");
```

- [ ] **Step 4: Run tests, then real ingest**

Run: `cd web && npx vitest run src/lib/ingest.test.ts` — Expected: PASS.
Run: `cd web && npm run ingest` — Expected: 27 lines + `done: 27 statements`. Sanity: `sqlite3 ../data/app.db "SELECT COUNT(*) FROM transactions"` ≈ 1341.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/ingest.ts web/src/lib/ingest.test.ts web/scripts/ingest.ts
git commit -m "feat: statement ingest into sqlite"
```

---

### Task 5: CPI module + fetcher (`cpi.ts`, `scripts/fetch-ipc.ts`)

**Files:**
- Create: `web/src/lib/cpi.ts`, `web/scripts/fetch-ipc.ts`, `data/ipc.json` (produced by fetcher, committed as cache — spec §6 "cached fallback")
- Test: `web/src/lib/cpi.test.ts`

**Interfaces:**
- Produces: `type CpiTable = Record<string, number>` (month `"YYYY-MM"` → index); `toReal(amountArs: number, fromMonth: string, toMonth: string, table: CpiTable): number`; `latestMonth(table): string`; `loadCpi(): CpiTable` (reads `data/ipc.json`). Missing month → falls back to the **nearest earlier** month present; table empty → throws `"CPI table empty — run npm run fetch-ipc"`.

- [ ] **Step 1: Write the failing test**

`web/src/lib/cpi.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toReal, latestMonth } from "@/lib/cpi";

const table = { "2025-01": 100, "2025-02": 110, "2025-04": 133.1 };

describe("cpi", () => {
  it("deflates by index ratio", () => {
    expect(toReal(1000, "2025-01", "2025-02", table)).toBeCloseTo(1100);
  });
  it("falls back to nearest earlier month", () => {
    // 2025-03 missing -> uses 2025-02
    expect(toReal(1000, "2025-03", "2025-04", table)).toBeCloseTo(1210);
  });
  it("latestMonth", () => {
    expect(latestMonth(table)).toBe("2025-04");
  });
  it("throws on empty table", () => {
    expect(() => toReal(1, "2025-01", "2025-02", {})).toThrow(/fetch-ipc/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/cpi.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/cpi.ts`:
```ts
import fs from "node:fs";
import path from "node:path";

export type CpiTable = Record<string, number>;

function indexFor(month: string, table: CpiTable): number {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error("CPI table empty — run npm run fetch-ipc");
  if (table[month] !== undefined) return table[month];
  const earlier = months.filter(m => m < month);
  if (earlier.length === 0) throw new Error(`No CPI data at or before ${month}`);
  return table[earlier[earlier.length - 1]];
}

export function toReal(amountArs: number, fromMonth: string, toMonth: string, table: CpiTable): number {
  return amountArs * (indexFor(toMonth, table) / indexFor(fromMonth, table));
}

export function latestMonth(table: CpiTable): string {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error("CPI table empty — run npm run fetch-ipc");
  return months[months.length - 1];
}

export function loadCpi(): CpiTable {
  const p = path.resolve(process.cwd(), "..", "data", "ipc.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as CpiTable;
}
```

`web/scripts/fetch-ipc.ts` (INDEC IPC nivel general nacional via datos.gob.ar series API; writes cache file):
```ts
import fs from "node:fs";
import path from "node:path";

const SERIES_ID = "148.3_INIVELNAL_DICI_M_26"; // IPC nivel general, nacional, índice
const URL = `https://apis.datos.gob.ar/series/api/series/?ids=${SERIES_ID}&limit=5000&format=json&start_date=2024-01-01`;

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`datos.gob.ar ${res.status}`);
  const body = await res.json();
  const table: Record<string, number> = {};
  for (const [date, value] of body.data as [string, number][]) {
    if (value != null) table[date.slice(0, 7)] = value;
  }
  if (Object.keys(table).length === 0) throw new Error("empty series — check SERIES_ID");
  const out = path.resolve(process.cwd(), "..", "data", "ipc.json");
  fs.writeFileSync(out, JSON.stringify(table, null, 1));
  console.log("wrote", out, Object.keys(table).length, "months, latest:", Object.keys(table).sort().at(-1));
}
main();
```

If the series id 404s, find the current one: `https://datosgobar.github.io/series-tiempo-ar-explorer/` search "IPC nivel general nacional índice" and swap `SERIES_ID`. Commit whatever `data/ipc.json` the fetch produces.

- [ ] **Step 4: Run tests + fetch**

Run: `cd web && npx vitest run src/lib/cpi.test.ts` — Expected: PASS.
Run: `cd web && npm run fetch-ipc` — Expected: `wrote .../data/ipc.json N months, latest: 2026-06` (INDEC publishes ~mid following month).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cpi.ts web/src/lib/cpi.test.ts web/scripts/fetch-ipc.ts data/ipc.json
git commit -m "feat: CPI deflator with INDEC fetcher and cached table"
```

---

### Task 6: Statement integrity check (`integrity.ts`)

**Files:**
- Create: `web/src/lib/integrity.ts`
- Test: `web/src/lib/integrity.test.ts`

**Interfaces:**
- Consumes: `StatementJson` (Task 4) — checks run on the raw JSON stored in `statements.raw`.
- Produces: `type Alert = { kind: "math_mismatch" | "balance_mismatch"; message: string; expected: number; actual: number }`; `checkStatement(json): Alert[]`. Tolerance: `Math.abs(diff) <= 1` peso passes (rounding).

- [ ] **Step 1: Write the failing test**

`web/src/lib/integrity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkStatement } from "@/lib/integrity";

const base = {
  file: "x.json", brand: "visa",
  period: { closing_date: "2026-07-30" },
  balances: { current_ars: 150 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS", block: 1, ars: 100, usd: null },
    { concept: "SALDO ACTUAL", block: null, ars: 150, usd: null },
  ],
  transactions: [
    { section: "purchases", block: 1, date: "2026-07-10", description: "A", ars: 60, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-11", description: "B", ars: 40, usd: null, installment_number: null, installment_count: null },
  ],
} as any;

describe("checkStatement", () => {
  it("passes when declared block total matches summed purchases", () => {
    expect(checkStatement(base)).toEqual([]);
  });
  it("flags mismatch beyond 1 peso tolerance", () => {
    const bad = structuredClone(base);
    bad.transactions[0].ars = 55;
    const alerts = checkStatement(bad);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "math_mismatch", expected: 100, actual: 95 });
  });
  it("flags SALDO ACTUAL vs balances mismatch", () => {
    const bad = structuredClone(base);
    bad.balances.current_ars = 999;
    const alerts = checkStatement(bad);
    expect(alerts.some(a => a.kind === "balance_mismatch")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/integrity.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/integrity.ts`:
```ts
export type Alert = {
  kind: "math_mismatch" | "balance_mismatch";
  message: string;
  expected: number;
  actual: number;
};

type RawStatement = {
  balances?: { current_ars?: number | null };
  declared_totals?: { concept: string; block: number | null; ars: number | null }[];
  transactions: { section: string; block?: number | null; ars: number | null }[];
};

const TOLERANCE = 1; // pesos

export function checkStatement(json: RawStatement): Alert[] {
  const alerts: Alert[] = [];
  for (const dt of json.declared_totals ?? []) {
    if (dt.concept.startsWith("TOTAL CONSUMOS") && dt.block != null && dt.ars != null) {
      const actual = json.transactions
        .filter(t => t.section === "purchases" && t.block === dt.block)
        .reduce((s, t) => s + (t.ars ?? 0), 0);
      if (Math.abs(actual - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "math_mismatch",
          message: `Block ${dt.block}: declared ${dt.ars} vs summed ${actual.toFixed(2)}`,
          expected: dt.ars, actual: Math.round(actual * 100) / 100,
        });
      }
    }
    if (dt.concept === "SALDO ACTUAL" && dt.ars != null && json.balances?.current_ars != null) {
      if (Math.abs(json.balances.current_ars - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "balance_mismatch",
          message: `SALDO ACTUAL ${dt.ars} vs balances.current_ars ${json.balances.current_ars}`,
          expected: dt.ars, actual: json.balances.current_ars,
        });
      }
    }
  }
  return alerts;
}
```

Note: duplicate-charge and amount-jump anomaly detection are Phase 2 (spec §3 anomaly suite); Phase 1 alerts tile shows only these integrity checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/integrity.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/integrity.ts web/src/lib/integrity.test.ts
git commit -m "feat: statement math integrity checks"
```

---

### Task 7: Recurring-charge detection (`recurring.ts`)

**Files:**
- Create: `web/src/lib/recurring.ts`
- Test: `web/src/lib/recurring.test.ts`

**Interfaces:**
- Consumes: transaction rows shape `{ merchant: string; month: string; ars: number | null; installment_count?: number | null }` (month = statement `closing_date.slice(0,7)`).
- Produces: `type RecurringCharge = { merchant: string; occurrences: number; lastMonth: string; lastAmount: number; prevAmount: number | null; pctChange: number | null; nextExpectedMonth: string }`; `detectRecurring(rows, opts?): RecurringCharge[]`. Heuristics (research: Actual Budget): merchant appears in **≥3 distinct months** AND in **≥60% of months** between its first and last appearance; cuota rows (`installment_count != null`) excluded — cuotas are contractual, not recurring. `pctChange` = (last − prev)/prev × 100 on **nominal** amounts (a real-terms recurring charge is flat; nominal jump is the signal, spec §3).

- [ ] **Step 1: Write the failing test**

`web/src/lib/recurring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectRecurring } from "@/lib/recurring";

const row = (merchant: string, month: string, ars: number, installment_count: number | null = null) =>
  ({ merchant, month, ars, date: `${month}-10`, installment_count });

describe("detectRecurring", () => {
  it("finds monthly merchant with >=3 months and computes change", () => {
    const rows = [
      row("SPOTIFY", "2026-04", 5000),
      row("SPOTIFY", "2026-05", 5000),
      row("SPOTIFY", "2026-06", 6000),
    ];
    const r = detectRecurring(rows);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      merchant: "SPOTIFY", occurrences: 3, lastMonth: "2026-06",
      lastAmount: 6000, prevAmount: 5000, nextExpectedMonth: "2026-07",
    });
    expect(r[0].pctChange).toBeCloseTo(20);
  });
  it("ignores merchants seen <3 months or sparse (<60% of span)", () => {
    const sparse = [row("A", "2026-01", 1), row("A", "2026-04", 1), row("A", "2026-07", 1)]; // 3 of 7 months
    const few = [row("B", "2026-01", 1), row("B", "2026-02", 1)];
    expect(detectRecurring([...sparse, ...few])).toHaveLength(0);
  });
  it("excludes cuota rows", () => {
    const rows = [row("TIENDA", "2026-01", 100, 12), row("TIENDA", "2026-02", 100, 12), row("TIENDA", "2026-03", 100, 12)];
    expect(detectRecurring(rows)).toHaveLength(0);
  });
  it("sums same-merchant same-month rows (e.g. OSDE billed per member)", () => {
    const rows = [
      row("OSDE", "2026-04", 100), row("OSDE", "2026-04", 50),
      row("OSDE", "2026-05", 150), row("OSDE", "2026-06", 150),
    ];
    const r = detectRecurring(rows);
    expect(r[0].lastAmount).toBe(150);
    expect(r[0].occurrences).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/recurring.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/recurring.ts`:
```ts
export type RecurringCharge = {
  merchant: string;
  occurrences: number;
  lastMonth: string;
  lastAmount: number;
  prevAmount: number | null;
  pctChange: number | null;
  nextExpectedMonth: string;
};

type Row = { merchant: string; month: string; ars: number | null; installment_count?: number | null };

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1; // inclusive span
}

function addMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 1)); // mo is 0-indexed next month
  return d.toISOString().slice(0, 7);
}

export function detectRecurring(
  rows: Row[],
  opts: { minMonths?: number; minDensity?: number } = {}
): RecurringCharge[] {
  const { minMonths = 3, minDensity = 0.6 } = opts;
  const byMerchant = new Map<string, Map<string, number>>(); // merchant -> month -> summed ars
  for (const r of rows) {
    if (r.installment_count != null) continue;
    if (r.ars == null || r.ars <= 0) continue;
    const months = byMerchant.get(r.merchant) ?? new Map();
    months.set(r.month, (months.get(r.month) ?? 0) + r.ars);
    byMerchant.set(r.merchant, months);
  }
  const out: RecurringCharge[] = [];
  for (const [merchant, months] of byMerchant) {
    const sorted = [...months.keys()].sort();
    if (sorted.length < minMonths) continue;
    const span = monthsBetween(sorted[0], sorted[sorted.length - 1]);
    if (sorted.length / span < minDensity) continue;
    const lastMonth = sorted[sorted.length - 1];
    const prevMonth = sorted[sorted.length - 2];
    const lastAmount = months.get(lastMonth)!;
    const prevAmount = prevMonth ? months.get(prevMonth)! : null;
    out.push({
      merchant,
      occurrences: sorted.length,
      lastMonth,
      lastAmount,
      prevAmount,
      pctChange: prevAmount ? ((lastAmount - prevAmount) / prevAmount) * 100 : null,
      nextExpectedMonth: addMonth(lastMonth),
    });
  }
  return out.sort((a, b) => b.lastAmount - a.lastAmount);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/recurring.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/recurring.ts web/src/lib/recurring.test.ts
git commit -m "feat: recurring charge detection"
```

---

### Task 8: Query layer (`queries.ts`)

**Files:**
- Create: `web/src/lib/queries.ts`
- Test: `web/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `openDb` (2), `toReal`/`latestMonth`/`loadCpi` (5), `detectRecurring` (7), `checkStatement` (6).
- Produces (all take `db` and a `ValueOpts`; pages call these from server components):
  - `type SpendMode = "cash" | "accrual"`; `type ValueMode = "nominal" | "real"`; `type ValueOpts = { spend: SpendMode; value: ValueMode; cpi: CpiTable }`
  - `monthlySpendByCategory(db, opts): { month: string; category: string; amount: number }[]`
  - `categoryDrill(db, opts, filter: { category?: string; subcategory?: string; month?: string }): { rows: DrillRow[]; groups: { key: string; amount: number }[] }` where `DrillRow = { date: string | null; description: string; merchant: string; category: string; subcategory: string | null; ars: number | null; usd: number | null; month: string }`
  - `recurringTable(db): RecurringCharge[]`
  - `periodComparison(db, opts, granularity: "month" | "quarter" | "year"): { period: string; amount: number; pctVsPrev: number | null }[]`
  - `eli5(db, opts): { spentThisMonth: number; pctVsPrevReal: number | null; committedNextMonth: number; topCategories: { category: string; amount: number }[]; alertCount: number; cuotaMonths: number; cuotaTotal: number; sparkline: { month: string; amount: number }[]; latestClosing: string; nextDueDate: string | null }`
- **Spend semantics** (Global Constraints): base rows = `section='purchases' AND ars > 0`. `cash`: rows as billed. `accrual`: rows with `installment_number = 1` count as `ars × installment_count`; rows with `installment_number > 1` excluded; non-cuota rows as-is. `real`: every amount deflated from its statement month to `latestMonth(cpi)`. Tx month = statement `closing_date.slice(0,7)`.

- [ ] **Step 1: Write the failing test**

`web/src/lib/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { monthlySpendByCategory, periodComparison, eli5 } from "@/lib/queries";

const cpi = { "2026-06": 100, "2026-07": 110 };

function seed(db: Database.Database) {
  const ins = db.prepare(
    `INSERT INTO statements (file, brand, closing_date, due_date, raw) VALUES (?, 'visa', ?, ?, '{"declared_totals":[],"transactions":[]}')`
  );
  const s1 = ins.run("v_2026_06.json", "2026-06-26", "2026-07-07").lastInsertRowid;
  const s2 = ins.run("v_2026_07.json", "2026-07-30", "2026-08-07").lastInsertRowid;
  const tx = db.prepare(
    `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
     VALUES (?, 'purchases', ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
  );
  // June: simple food purchase 1000
  tx.run(s1, "2026-06-10", "COTO", "COTO", "food", 1000, null, null);
  // July: food 1000 nominal + cuota 1/6 of 600 (shopping)
  tx.run(s2, "2026-07-10", "COTO", "COTO", "food", 1000, null, null);
  tx.run(s2, "2026-07-11", "TIENDA C.01/06", "TIENDA", "shopping", 100, 1, 6);
  tx.run(s2, "2026-07-12", "TIENDA C.02/06", "TIENDA", "shopping", 100, 2, 6); // pretend prior purchase
  db.prepare("INSERT INTO installments_upcoming (statement_id, month, amount_ars) VALUES (?, '2026-08', 200)").run(s2);
  db.prepare("INSERT INTO installments_upcoming (statement_id, month, amount_ars) VALUES (?, '2026-09', 100)").run(s2);
}

describe("queries", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(":memory:"); seed(db); });

  it("accrual expands cuota 1/N and drops later cuotas", () => {
    const r = monthlySpendByCategory(db, { spend: "accrual", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 1000, shopping: 600 }); // 100×6, cuota 02 dropped
  });

  it("cash sums as billed", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 1000, shopping: 200 });
  });

  it("real mode deflates June to July pesos", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "real", cpi });
    const june = r.find(x => x.month === "2026-06" && x.category === "food")!;
    expect(june.amount).toBeCloseTo(1100); // 1000 × 110/100
  });

  it("periodComparison computes real deltas", () => {
    const r = periodComparison(db, { spend: "cash", value: "real", cpi }, "month");
    expect(r.map(x => x.period)).toEqual(["2026-06", "2026-07"]);
    expect(r[1].pctVsPrev).toBeCloseTo(((1200 - 1100) / 1100) * 100);
  });

  it("eli5 tiles", () => {
    const t = eli5(db, { spend: "cash", value: "real", cpi });
    expect(t.spentThisMonth).toBeCloseTo(1200);
    expect(t.committedNextMonth).toBe(200);
    expect(t.cuotaMonths).toBe(2);
    expect(t.cuotaTotal).toBe(300);
    expect(t.sparkline).toHaveLength(2);
    expect(t.alertCount).toBe(0);
    expect(t.nextDueDate).toBe("2026-08-07");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/queries.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/queries.ts`:
```ts
import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";
import { checkStatement } from "@/lib/integrity";

export type SpendMode = "cash" | "accrual";
export type ValueMode = "nominal" | "real";
export type ValueOpts = { spend: SpendMode; value: ValueMode; cpi: CpiTable };

type BaseRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; ars: number; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

function baseRows(db: Database.Database): BaseRow[] {
  return db.prepare(`
    SELECT substr(s.closing_date, 1, 7) AS month, t.date, t.description, t.merchant,
           t.category, t.subcategory, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' AND t.ars > 0
    ORDER BY s.closing_date, t.date
  `).all() as BaseRow[];
}

function effectiveAmount(r: BaseRow, opts: ValueOpts): number | null {
  let amt = r.ars;
  if (opts.spend === "accrual") {
    if (r.installment_count != null) {
      if (r.installment_number !== 1) return null;      // later cuotas excluded
      amt = r.ars * r.installment_count;                 // full purchase at cuota 1
    }
  }
  if (opts.value === "real") amt = toReal(amt, r.month, latestMonth(opts.cpi), opts.cpi);
  return amt;
}

export function monthlySpendByCategory(db: Database.Database, opts: ValueOpts) {
  const acc = new Map<string, number>();
  for (const r of baseRows(db)) {
    const amt = effectiveAmount(r, opts);
    if (amt == null) continue;
    const key = `${r.month}|${r.category}`;
    acc.set(key, (acc.get(key) ?? 0) + amt);
  }
  return [...acc.entries()]
    .map(([k, amount]) => { const [month, category] = k.split("|"); return { month, category, amount }; })
    .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
}

export type DrillRow = Omit<BaseRow, "installment_number" | "installment_count">;

export function categoryDrill(
  db: Database.Database, opts: ValueOpts,
  filter: { category?: string; subcategory?: string; month?: string }
) {
  const rows: DrillRow[] = [];
  const groups = new Map<string, number>();
  for (const r of baseRows(db)) {
    if (filter.category && r.category !== filter.category) continue;
    if (filter.subcategory && r.subcategory !== filter.subcategory) continue;
    if (filter.month && r.month !== filter.month) continue;
    const amt = effectiveAmount(r, opts);
    if (amt == null) continue;
    rows.push({ month: r.month, date: r.date, description: r.description, merchant: r.merchant,
      category: r.category, subcategory: r.subcategory, ars: amt, usd: r.usd });
    // next drill level: category -> subcategory -> merchant
    const key = !filter.category ? r.category : !filter.subcategory ? (r.subcategory ?? "(none)") : r.merchant;
    groups.set(key, (groups.get(key) ?? 0) + amt);
  }
  return {
    rows: rows.sort((a, b) => (b.ars ?? 0) - (a.ars ?? 0)),
    groups: [...groups.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function recurringTable(db: Database.Database): RecurringCharge[] {
  return detectRecurring(baseRows(db));
}

export function periodComparison(
  db: Database.Database, opts: ValueOpts, granularity: "month" | "quarter" | "year"
) {
  const acc = new Map<string, number>();
  for (const r of baseRows(db)) {
    const amt = effectiveAmount(r, opts);
    if (amt == null) continue;
    const [y, m] = r.month.split("-").map(Number);
    const period = granularity === "month" ? r.month
      : granularity === "quarter" ? `${y}-Q${Math.ceil(m / 3)}` : String(y);
    acc.set(period, (acc.get(period) ?? 0) + amt);
  }
  const sorted = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([period, amount], i) => ({
    period, amount,
    pctVsPrev: i === 0 ? null : ((amount - sorted[i - 1][1]) / sorted[i - 1][1]) * 100,
  }));
}

export function eli5(db: Database.Database, opts: ValueOpts) {
  const months = monthlySpendByCategory(db, { ...opts, value: "real" });
  const byMonth = new Map<string, number>();
  for (const m of months) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.amount);
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const [lastMonthKey, spentThisMonth] = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2][1] : null;

  const latest = db.prepare(
    "SELECT id, closing_date, due_date, raw FROM statements ORDER BY closing_date DESC LIMIT 1"
  ).get() as { id: number; closing_date: string; due_date: string | null; raw: string };

  const upcoming = db.prepare(
    "SELECT month, SUM(amount_ars) amount FROM installments_upcoming WHERE statement_id = ? GROUP BY month ORDER BY month"
  ).all(latest.id) as { month: string; amount: number }[];

  const topCategories = months.filter(m => m.month === lastMonthKey)
    .sort((a, b) => b.amount - a.amount).slice(0, 3)
    .map(m => ({ category: m.category, amount: m.amount }));

  const allRaw = db.prepare("SELECT raw FROM statements").all() as { raw: string }[];
  const alertCount = allRaw.reduce((n, s) => n + checkStatement(JSON.parse(s.raw)).length, 0);

  return {
    spentThisMonth,
    pctVsPrevReal: prev ? ((spentThisMonth - prev) / prev) * 100 : null,
    committedNextMonth: upcoming[0]?.amount ?? 0,
    topCategories,
    alertCount,
    cuotaMonths: upcoming.length,
    cuotaTotal: upcoming.reduce((s, u) => s + u.amount, 0),
    sparkline: sorted.slice(-12).map(([month, amount]) => ({ month, amount })),
    latestClosing: latest.closing_date,
    nextDueDate: latest.due_date,
  };
}
```

- [ ] **Step 4: Run full test suite**

Run: `cd web && npm test` — Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts
git commit -m "feat: query layer with spend/value modes"
```

---

### Task 9: UI shell — layout, nav, mode toggles, formatting

**Files:**
- Create: `web/src/lib/format.ts`, `web/src/lib/params.ts`, `web/src/components/ModeToggle.tsx`, `web/src/components/Nav.tsx`
- Modify: `web/src/app/layout.tsx`
- Test: `web/src/lib/format.test.ts`, `web/src/lib/params.test.ts`

**Interfaces:**
- Produces: `fmtArs(n: number): string` (es-AR currency, 0 decimals); `fmtPct(n: number | null): string` (`"+12,3%"` / `"−4,1%"` / `"—"`); `parseModes(searchParams: { [k: string]: string | string[] | undefined }): { spend: SpendMode; value: ValueMode }` (defaults `{ spend: "accrual", value: "real" }`, invalid values fall back to defaults); `<ModeToggle />` client component writing `?value=`/`?spend=` via router; `<Nav />` links: `/` Overview, `/trends` Trends, `/categories` Categories, `/recurring` Recurring, `/compare` Compare.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fmtArs, fmtPct } from "@/lib/format";

describe("format", () => {
  it("formats ARS es-AR, no decimals", () => {
    expect(fmtArs(1234567.89).replace(/\u00A0/g, " ")).toBe("$ 1.234.568");
  });
  it("formats pct with sign, comma decimal, em dash for null", () => {
    expect(fmtPct(12.34)).toBe("+12,3%");
    expect(fmtPct(-4.06)).toBe("−4,1%");
    expect(fmtPct(null)).toBe("—");
  });
});
```

`web/src/lib/params.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseModes } from "@/lib/params";

describe("parseModes", () => {
  it("defaults to accrual + real", () => {
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real" });
  });
  it("reads valid params, rejects junk", () => {
    expect(parseModes({ spend: "cash", value: "nominal" })).toEqual({ spend: "cash", value: "nominal" });
    expect(parseModes({ spend: "bogus", value: "nominal" })).toEqual({ spend: "accrual", value: "nominal" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/format.test.ts src/lib/params.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/format.ts`:
```ts
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function fmtArs(n: number): string {
  return ars.format(n);
}

export function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(1).replace(".", ",")}%`;
}
```

`web/src/lib/params.ts`:
```ts
import type { SpendMode, ValueMode } from "@/lib/queries";

type SP = { [k: string]: string | string[] | undefined };

export function parseModes(sp: SP): { spend: SpendMode; value: ValueMode } {
  const spend = sp.spend === "cash" ? "cash" : "accrual";
  const value = sp.value === "nominal" ? "nominal" : "real";
  return { spend, value };
}
```

`web/src/components/ModeToggle.tsx`:
```tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

function Seg({ param, options, current }: { param: string; options: [string, string][]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set(param, val);
            router.replace(`${pathname}?${next.toString()}`);
          }}
          className={val === current
            ? "px-3 py-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "px-3 py-1 bg-transparent"}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ModeToggle({ spend, value }: { spend: string; value: string }) {
  return (
    <div className="flex gap-3">
      <Seg param="value" current={value} options={[["real", "Real $"], ["nominal", "Nominal $"]]} />
      <Seg param="spend" current={spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
    </div>
  );
}
```

`web/src/components/Nav.tsx`:
```tsx
import Link from "next/link";

const links = [
  ["/", "Overview"], ["/trends", "Trends"], ["/categories", "Categories"],
  ["/recurring", "Recurring"], ["/compare", "Compare"],
] as const;

export function Nav() {
  return (
    <nav className="flex gap-4 py-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="text-sm font-medium hover:underline">{label}</Link>
      ))}
    </nav>
  );
}
```

`web/src/app/layout.tsx` — wrap children:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Tarjetas", description: "Credit card statement analysis" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="max-w-5xl mx-auto px-4 antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Run tests + build**

Run: `cd web && npm test` — Expected: PASS. Run: `npm run build` — Expected: success.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/format.ts web/src/lib/format.test.ts web/src/lib/params.ts web/src/lib/params.test.ts web/src/components web/src/app/layout.tsx
git commit -m "feat: UI shell with nav and mode toggles"
```

---

### Task 10: ELI5 overview page (`/`)

**Files:**
- Create: `web/src/components/Sparkline.tsx`
- Modify: `web/src/app/page.tsx` (replace scaffold content)

**Interfaces:**
- Consumes: `eli5` (8), `parseModes` (9), `fmtArs`/`fmtPct` (9), `loadCpi` (5), `openDb` (2), `ModeToggle` (9).
- Produces: 6 tiles per spec §4 ELI5 screen, each linking to its deep view.

- [ ] **Step 1: Implement**

`web/src/components/Sparkline.tsx`:
```tsx
"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";

export function Sparkline({ data }: { data: { month: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="amount" stroke="currentColor" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/page.tsx`:
```tsx
import Link from "next/link";
import { openDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { eli5 } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import { fmtArs, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Sparkline } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

function Tile({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:shadow-md transition-shadow">
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      {children}
    </Link>
  );
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const db = openDb();
  const cpi = loadCpi();
  const t = eli5(db, { ...modes, cpi });
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Statement {t.latestClosing}</h1>
        <ModeToggle spend={modes.spend} value={modes.value} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Tile href="/trends" label="Spent this statement (real)">
          <div className="text-2xl font-bold">{fmtArs(t.spentThisMonth)}</div>
          <div className="text-sm text-zinc-500">{fmtPct(t.pctVsPrevReal)} vs last month</div>
        </Tile>
        <Tile href="/recurring" label="Committed next month">
          <div className="text-2xl font-bold">{fmtArs(t.committedNextMonth)}</div>
          <div className="text-sm text-zinc-500">due after {t.nextDueDate ?? "—"}</div>
        </Tile>
        <Tile href="/categories" label="Top categories">
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span>{c.category}</span><span>{fmtArs(c.amount)}</span>
            </div>
          ))}
        </Tile>
        <Tile href="/recurring" label="Alerts">
          <div className="text-2xl font-bold">{t.alertCount}</div>
          <div className="text-sm text-zinc-500">statement integrity issues</div>
        </Tile>
        <Tile href="/compare" label="Cuota burden">
          <div className="text-2xl font-bold">{fmtArs(t.cuotaTotal)}</div>
          <div className="text-sm text-zinc-500">over next {t.cuotaMonths} months</div>
        </Tile>
        <Tile href="/trends" label="12-month trend (real)">
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `cd web && npm run dev`, open `http://localhost:3000`. Expected: 6 tiles with real numbers from the 27 statements; toggles change values; each tile navigates.

- [ ] **Step 3: Build + commit**

Run: `npm run build` — Expected: success.

```bash
git add web/src/app/page.tsx web/src/components/Sparkline.tsx
git commit -m "feat: ELI5 overview screen"
```

---

### Task 11: Trends page (chart 1) + Compare page (chart 7)

**Files:**
- Create: `web/src/app/trends/page.tsx`, `web/src/app/compare/page.tsx`, `web/src/components/StackedArea.tsx`, `web/src/components/CompareBars.tsx`, `web/src/lib/colors.ts`

**Interfaces:**
- Consumes: `monthlySpendByCategory`, `periodComparison` (8); shell pieces (9).
- Produces: `CATEGORY_COLORS: Record<string, string>` (stable color per category, used again in Task 12).

- [ ] **Step 1: Implement**

`web/src/lib/colors.ts`:
```ts
export const CATEGORY_COLORS: Record<string, string> = {
  food: "#16a34a", transport: "#0ea5e9", subscriptions: "#8b5cf6", health: "#ef4444",
  entertainment: "#f59e0b", shopping: "#ec4899", services: "#14b8a6", travel: "#6366f1",
  education: "#84cc16", taxes_fees: "#71717a", transfers: "#a1a1aa", other: "#d4d4d8",
};
```

`web/src/components/StackedArea.tsx`:
```tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CATEGORY_COLORS } from "@/lib/colors";
import { fmtArs } from "@/lib/format";

export function StackedArea({ data, categories }: {
  data: Record<string, number | string>[]; categories: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <AreaChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} />
        <Legend />
        {categories.map(c => (
          <Area key={c} type="monotone" dataKey={c} stackId="1"
            stroke={CATEGORY_COLORS[c]} fill={CATEGORY_COLORS[c]} fillOpacity={0.7} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/trends/page.tsx`:
```tsx
import { openDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { monthlySpendByCategory } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { StackedArea } from "@/components/StackedArea";

export const dynamic = "force-dynamic";

export default async function Trends({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const rows = monthlySpendByCategory(openDb(), { ...modes, cpi: loadCpi() });
  const categories = [...new Set(rows.map(r => r.category))].sort();
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { month: r.month };
    m[r.category] = r.amount;
    byMonth.set(r.month, m);
  }
  const data = [...byMonth.values()];
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Monthly spend by category</h1>
        <ModeToggle spend={modes.spend} value={modes.value} />
      </div>
      <StackedArea data={data} categories={categories} />
    </main>
  );
}
```

`web/src/components/CompareBars.tsx`:
```tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { fmtArs, fmtPct } from "@/lib/format";

export function CompareBars({ data }: { data: { period: string; amount: number; pctVsPrev: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <XAxis dataKey="period" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} />
        <Bar dataKey="amount" fill="#0ea5e9">
          <LabelList dataKey="pctVsPrev" position="top" fontSize={11}
            formatter={(v) => (v == null ? "" : fmtPct(Number(v)))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/compare/page.tsx`:
```tsx
import Link from "next/link";
import { openDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { periodComparison } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CompareBars } from "@/components/CompareBars";

export const dynamic = "force-dynamic";

export default async function Compare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
  const data = periodComparison(openDb(), { ...modes, cpi: loadCpi() }, g);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Period comparison</h1>
        <ModeToggle spend={modes.spend} value={modes.value} />
      </div>
      <div className="flex gap-2 mb-4 text-sm">
        {(["month", "quarter", "year"] as const).map(x => (
          <Link key={x} href={`/compare?g=${x}&spend=${modes.spend}&value=${modes.value}`}
            className={x === g ? "font-bold underline" : "hover:underline"}>{x}</Link>
        ))}
      </div>
      <CompareBars data={data} />
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

`/trends`: stacked area over ~19 months, real terms default, toggle flips shape (nominal should slope up steeply — inflation). `/compare`: month/quarter/year switch works, % labels shown.

- [ ] **Step 3: Build + commit**

Run: `cd web && npm run build` — Expected: success.

```bash
git add web/src/app/trends web/src/app/compare web/src/components/StackedArea.tsx web/src/components/CompareBars.tsx web/src/lib/colors.ts
git commit -m "feat: trends and period comparison charts"
```

---

### Task 12: Categories drill page (chart 5) + Recurring page (chart 6)

**Files:**
- Create: `web/src/app/categories/page.tsx`, `web/src/app/recurring/page.tsx`, `web/src/components/DrillBars.tsx`

**Interfaces:**
- Consumes: `categoryDrill`, `recurringTable` (8), `CATEGORY_COLORS` (11), shell (9).
- Produces: drill URL scheme `/categories?category=food&subcategory=delivery&month=2026-07` — each bar click descends one level; breadcrumb clears levels.

- [ ] **Step 1: Implement**

`web/src/components/DrillBars.tsx`:
```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CATEGORY_COLORS } from "@/lib/colors";
import { fmtArs } from "@/lib/format";

export function DrillBars({ groups, level }: {
  groups: { key: string; amount: number }[];
  level: "category" | "subcategory" | "merchant";
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const onClick = (key: string) => {
    if (level === "merchant") return;
    const next = new URLSearchParams(sp.toString());
    next.set(level, key);
    router.push(`/categories?${next.toString()}`);
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, groups.length * 36)}>
      <BarChart data={groups} layout="vertical">
        <XAxis type="number" tickFormatter={(v: number) => fmtArs(v)} fontSize={12} />
        <YAxis type="category" dataKey="key" width={180} fontSize={12} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} />
        <Bar dataKey="amount" onClick={(d) => onClick((d as unknown as { key: string }).key)} cursor={level === "merchant" ? "default" : "pointer"}>
          {groups.map(g => (
            <Cell key={g.key} fill={CATEGORY_COLORS[g.key] ?? "#0ea5e9"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/categories/page.tsx`:
```tsx
import Link from "next/link";
import { openDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { categoryDrill } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { DrillBars } from "@/components/DrillBars";

export const dynamic = "force-dynamic";

export default async function Categories({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const filter = {
    category: typeof sp.category === "string" ? sp.category : undefined,
    subcategory: typeof sp.subcategory === "string" ? sp.subcategory : undefined,
    month: typeof sp.month === "string" ? sp.month : undefined,
  };
  const { rows, groups } = categoryDrill(openDb(), { ...modes, cpi: loadCpi() }, filter);
  const level = !filter.category ? "category" : !filter.subcategory ? "subcategory" : "merchant";
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Categories</h1>
        <ModeToggle spend={modes.spend} value={modes.value} />
      </div>
      <div className="text-sm mb-4 flex gap-2">
        <Link href="/categories" className="hover:underline">all</Link>
        {filter.category && <><span>/</span><Link href={`/categories?category=${filter.category}`} className="hover:underline">{filter.category}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
      </div>
      <DrillBars groups={groups} level={level} />
      {level !== "category" && (
        <table className="w-full text-sm mt-6">
          <thead><tr className="text-left text-zinc-500">
            <th className="py-1">Date</th><th>Description</th><th className="text-right">ARS</th><th className="text-right">USD</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                <td>{r.description}</td>
                <td className="text-right">{r.ars != null ? fmtArs(r.ars) : "—"}</td>
                <td className="text-right">{r.usd ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

`web/src/app/recurring/page.tsx`:
```tsx
import { openDb } from "@/lib/db";
import { recurringTable } from "@/lib/queries";
import { fmtArs, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Recurring() {
  const rows = recurringTable(openDb());
  return (
    <main>
      <h1 className="text-xl font-semibold mb-4">Recurring charges</h1>
      <p className="text-sm text-zinc-500 mb-4">Nominal amounts — % change vs previous month is the inflation/price-hike signal.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">Merchant</th><th className="text-right">Months seen</th>
          <th className="text-right">Last amount</th><th className="text-right">Change</th>
          <th className="text-right">Next expected</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.merchant} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1">{r.merchant}</td>
              <td className="text-right">{r.occurrences}</td>
              <td className="text-right">{fmtArs(r.lastAmount)}</td>
              <td className={`text-right ${r.pctChange != null && r.pctChange > 10 ? "text-red-600 font-medium" : ""}`}>{fmtPct(r.pctChange)}</td>
              <td className="text-right">{r.nextExpectedMonth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

`/categories`: bars by category → click food → subcategories → click delivery → merchants + tx table. `/recurring`: Spotify/OSDE/streaming rows present, >10% jumps highlighted red.

- [ ] **Step 3: Full suite + build + commit**

Run: `cd web && npm test && npm run build` — Expected: ALL PASS + build success.

```bash
git add web/src/app/categories web/src/app/recurring web/src/components/DrillBars.tsx
git commit -m "feat: category drill and recurring charges pages"
```

---

## Phase 1 Done Criteria

- `npm run ingest` idempotently loads all 27 statements (~1341 tx).
- `npm test` green; `npm run build` clean.
- `/` shows 6 live tiles; `/trends`, `/categories` (3-level drill + tx table), `/recurring`, `/compare` all render real data.
- Real-terms default everywhere ARS aggregates appear; nominal + cash/accrual toggles work via URL params.

## Phase 2 Outline (separate plan when Phase 1 ships)

Per spec §10: MEP fetcher + USD value mode (chart 9); cuota waterfall with 3 projection layers (chart 4, spec §5); anomaly engine — duplicates, amount jumps, never-seen merchants (chart 10); personal-inflation lens vs INDEC IPC (chart 8); Sankey (chart 2); calendar heatmap (chart 3); alert history persistence; tax-inclusive "true cost" toggle (spec §3 — Phase 1 spend views are purchases-only, pre-tax).

## Phase 3 Outline (separate plan)

Per spec §10: drag-drop PDF upload → route handler invoking `scripts/pdf_to_json.py`; LLM-assisted categorization flow (merchant string only, writes to `data/merchant-categories.json`, manual override wins — spec §7); alert review UI.
