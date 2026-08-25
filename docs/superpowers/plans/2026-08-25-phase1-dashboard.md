# Phase 1 Dashboard Implementation Plan (rev A — post-review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local Next.js + SQLite dashboard over the 27 statement JSONs: ELI5 one-screen summary + charts 1 (stacked area), 5 (category drill), 6 (recurring table), 7 (period comparison), with real-terms (CPI-adjusted) default.

**Architecture:** Next.js App Router app in `web/`. A TypeScript ingest CLI reads `json/*.json` into SQLite (`data/app.db`) with normalized merchants, rule-based categories, a computed **cycle month** (billing-cycle midpoint — statements closing the 2nd of a month belong to the *previous* month's cycle), and integrity alerts computed **at ingest**. Server components query SQLite via a pure query layer; Recharts client components render. Value mode (nominal/real) and spend mode (cash/accrual) travel as URL search params and are preserved across navigation.

**Tech Stack:** Next.js 15 (App Router, TS), better-sqlite3, Recharts, Tailwind, vitest, tsx.

**Spec:** `docs/analysis.md` (sections 1–7, 10). Research: `docs/research-financial-apps.md`.

## Review Revisions (2026-08-25)

This revision incorporates a 3-lens pre-execution review (standards / simplicity / correctness-vs-real-data). Key decisions an executor must not "fix" backward:

1. **Months are `cycle_month`** (billing-cycle midpoint), never `closing_date.slice(0,7)` — real data has 4 statements closing in calendar 2026-07 (two are the June cycle, closed July 2). Keying by closing month doubles months and empties their neighbors.
2. **Negative purchases are kept** (refunds/bonifications/reversals net against spend). Real data: −576k ARS in one month, incl. a double-charge + reversal. Dropping them double-counts.
3. **USD-only purchases (`ars: null, usd > 0`) stay in base rows** — excluded from ARS aggregates but present in drill lists and recurring detection (currency-aware). Spotify billed in USD from 2025-06 on; 164 such rows exist.
4. **Accrual mode uses first-*observed* cuota**: for a series whose lowest seen `installment_number` is k, count `ars × (count − k + 1)` at that month. Six real series start mid-window (purchase predates data); plain `k=1` logic silently vanishes ~780k.
5. **Integrity checks run at ingest** and persist to an `alerts` table. No `raw` JSON column, no per-request re-checking.
6. **`getDb()`/`getCpi()` are module-cached singletons** for pages; `openDb(":memory:")`/explicit tables remain the test seam.
7. **Merchant regex normalization is best-effort** — `DLOCAL*`/`DLO*` prefixes stripped, `ID:`+digit tails stripped, `[._*]` → space. Truncated variants (`HELP HBOM` vs `HELP HBOMAX COM`) still split; a merchant-alias map is **deferred to Phase 2** deliberately.
8. **Rule order matters** in `merchant-categories.json` (first match wins): `MOVISTAR AR` (Movistar Arena, entertainment) is listed before `MOVISTAR` (phone).
9. **Mastercard has coverage gaps** (8 of ~19 months). Comparisons render a per-month brand-coverage footnote rather than pretending months are comparable.
10. **eli5 honors both toggles**; "real" is the default, not hardcoded. Cuota tiles aggregate the latest statement **per brand** (two cards close the same day; `LIMIT 1` picks one arbitrarily).

## Global Constraints

- All lib code in `web/src/lib/`, one responsibility per file. Pure functions take data in, return data out — DB touched only in `db.ts` and `queries.ts`.
- Default value mode: **real** (constant pesos, latest CPI month as base, base month labeled in UI). Toggle to nominal. (spec §1, §6)
- Two spend modes: `cash` (as billed) and `accrual` (full/remaining price at first-observed cuota, later cuotas excluded). Default **accrual**. (spec §3)
- Zero LLM calls; categorization is rules-only in Phase 1. (spec §1, §7)
- ARS aggregates only in Phase 1 charts; USD rows appear in drill lists and recurring (flagged), never in ARS sums.
- Sections in data: `payments`, `purchases`, `taxes_and_charges`. Spend = `purchases` (positive *and* negative, netting); `taxes_and_charges` → category `taxes_fees`, excluded from Phase 1 spend views (tax-inclusive view is Phase 2).
- UI copy in English; merchant/category names as-is.
- Money display: `Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0})`.
- Node ≥ 20. `data/app.db` gitignored; `data/*.json` committed. CLI scripts end with `main().catch(e => { console.error(e); process.exit(1); })` discipline and name the offending file in errors.
- No `as any` in tests — fixtures typed with `satisfies StatementJson`.
- Commit after every task. Repo root is the git root; the Next app lives in `web/`.

---

### Task 1: Scaffold `web/` app + test runner

**Files:**
- Create: `web/` (via create-next-app), `web/vitest.config.ts`
- Modify: `.gitignore`, `web/next.config.ts`, `web/package.json` (scripts)

**Interfaces:**
- Produces: working `npm run dev`, `npm test` (vitest), path alias `@/` → `web/src/`.

- [x] **Step 1: Scaffold**

```bash
cd /Users/user/Desktop/Tarjetas
npx create-next-app@latest web --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-npm --yes
cd web && npm i better-sqlite3 recharts && npm i -D vitest tsx @types/better-sqlite3
```

- [x] **Step 2: Configure**

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
  test: { include: ["src/**/*.test.ts"], passWithNoTests: true },
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

- [x] **Step 3: Verify**

Run: `cd web && npm test` → exit 0 (passWithNoTests); `npm run build` → succeeds.

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js app with vitest"
```

---

### Task 2: Paths, SQLite schema + connection (`paths.ts`, `db.ts`)

**Files:**
- Create: `web/src/lib/paths.ts`, `web/src/lib/db.ts`
- Test: `web/src/lib/db.test.ts`

**Interfaces:**
- Produces:
  - `DATA_DIR: string` (single source for `../data` resolution — `paths.ts`)
  - `openDb(path?: string): Database.Database` (defaults `DATA_DIR/app.db`, creates dir, runs `migrate`) — the **test seam**
  - `getDb(): Database.Database` — globalThis-cached singleton for pages (never used in tests)
  - `migrate(db): void`
- Tables (later tasks depend on these exact names): `statements(id, file UNIQUE, brand, closing_date, cycle_month, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars)`, `transactions(id, statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)`, `upcoming_installments(statement_id, month, amount_ars, PK(statement_id, month))`, `alerts(id, statement_id, kind, message, expected, actual)`.

- [x] **Step 1: Write the failing test**

`web/src/lib/db.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";

describe("db", () => {
  it("creates schema and accepts rows", () => {
    const db = openDb(":memory:");
    const s = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars)
       VALUES ('visa_x.json','visa','2026-07-30','2026-07','2026-08-07','2026-07-02',100,1,10)`
    ).run();
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', '2026-07-10', 'MERPAGO*X', 'X', 'other', NULL, 50, NULL, 1, 6)`
    ).run(s.lastInsertRowid);
    db.prepare(`INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-08', 375290.39)`)
      .run(s.lastInsertRowid);
    db.prepare(`INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?, 'math_mismatch', 'x', 100, 95)`)
      .run(s.lastInsertRowid);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 1 });
  });

  it("statement file unique; upcoming PK rejects dup month per statement", () => {
    const db = openDb(":memory:");
    const ins = db.prepare(`INSERT INTO statements (file, brand, closing_date, cycle_month) VALUES ('a.json','visa','2026-01-29','2026-01')`);
    const sid = ins.run().lastInsertRowid;
    expect(() => ins.run()).toThrow();
    const up = db.prepare(`INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-02', 1)`);
    up.run(sid);
    expect(() => up.run(sid)).toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db.test.ts` — Expected: FAIL (module not found).

- [x] **Step 3: Implement**

`web/src/lib/paths.ts`:
```ts
import path from "node:path";

// Single knob for where the repo-level data/ dir lives relative to web/.
export const DATA_DIR = path.resolve(process.cwd(), "..", "data");
```

`web/src/lib/db.ts`:
```ts
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
      minimum_payment_ars REAL
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
  `);
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db.test.ts` — Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/paths.ts web/src/lib/db.ts web/src/lib/db.test.ts
git commit -m "feat: sqlite schema, connection seam, page singleton"
```

---

### Task 3: Merchant normalization + rule categorization (`categorize.ts`)

**Files:**
- Create: `web/src/lib/categorize.ts`, `data/merchant-categories.json`
- Test: `web/src/lib/categorize.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES` const array + `type Category = typeof CATEGORIES[number]` — the taxonomy: `food, transport, subscriptions, health, entertainment, shopping, services, travel, education, taxes_fees, transfers, other` (spec §3)
  - `normalizeMerchant(description: string): string`
  - `categorize(description: string, section: string, rules: Rule[]): { category: Category; subcategory: string | null }`
  - `type Rule = { match: string; category: Category; subcategory?: string }`; `loadRules(): Rule[]` (reads `DATA_DIR/merchant-categories.json`)
- **Rule order matters**: first match wins — `MOVISTAR AR` (Arena/entertainment) must precede `MOVISTAR` (phone). Normalization replaces `[._*]` with spaces, so rules are written in spaced form (`APPLE COM/BILL`, not `APPLE.COM/BILL`).

- [x] **Step 1: Write the failing test**

`web/src/lib/categorize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeMerchant, categorize, type Rule } from "@/lib/categorize";

const rules: Rule[] = [
  { match: "MOVISTAR AR", category: "entertainment", subcategory: "events" },
  { match: "MOVISTAR", category: "services", subcategory: "phone" },
  { match: "OSDE", category: "health", subcategory: "insurance" },
  { match: "HBOM", category: "subscriptions", subcategory: "streaming" },
  { match: "PEDIDOSYA", category: "food", subcategory: "delivery" },
];

describe("normalizeMerchant", () => {
  it("strips marketplace prefixes incl. DLOCAL, punctuation to spaces, tails", () => {
    expect(normalizeMerchant("MERPAGO*TIENDANEWSAN")).toBe("TIENDANEWSAN");
    expect(normalizeMerchant("DLO*PEDIDOSYA PLUS")).toBe("PEDIDOSYA PLUS");
    expect(normalizeMerchant("DLOCAL*HELP HBOM")).toBe("HELP HBOM");
    expect(normalizeMerchant("PEDIDOSYA _ PLUS")).toBe("PEDIDOSYA PLUS");
    expect(normalizeMerchant("DLO*HELP_HBOMAX_COM")).toBe("HELP HBOMAX COM");
    expect(normalizeMerchant("help hbomax com")).toBe("HELP HBOMAX COM");
    expect(normalizeMerchant("Spotify USD 3,73")).toBe("SPOTIFY");
    expect(normalizeMerchant("APPLE.COM/BILL MT8ZSVB45USD 9,99")).toBe("APPLE COM/BILL");
    expect(normalizeMerchant("106851*MOVISTAR AREN")).toBe("MOVISTAR AREN");
  });
  it("strips both bare and ID:-prefixed account tails (real OSDE drift)", () => {
    expect(normalizeMerchant("OSDE 000012345678901")).toBe("OSDE");
    expect(normalizeMerchant("OSDE ID:000012345678901")).toBe("OSDE");
  });
});

describe("categorize", () => {
  it("first matching rule wins — Movistar Arena is events, not phone", () => {
    expect(categorize("292746*MOVISTAR AREN", "purchases", rules))
      .toEqual({ category: "entertainment", subcategory: "events" });
  });
  it("matches rules on normalized merchant across drifted variants", () => {
    for (const d of ["DLO*HELP_HBOMAX_COM", "help hbomax com", "DLOCAL*HELP HBOM"]) {
      expect(categorize(d, "purchases", rules).category).toBe("subscriptions");
    }
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

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/categorize.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/categorize.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export const CATEGORIES = [
  "food", "transport", "subscriptions", "health", "entertainment", "shopping",
  "services", "travel", "education", "taxes_fees", "transfers", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Rule = { match: string; category: Category; subcategory?: string };

const PREFIX_RE = /^(MERPAGO|MERCADOPAGO|DLOCAL|DLO|PAYU|EBANX|\d+)\*/i;
const USD_TAIL_RE = /\s*\S*USD\s*[\d.,]+$/i; // "USD 3,73" and glued "MT8ZSVB45USD 9,99"
const NUM_TAIL_RE = /\s+(ID:)?\d{6,}(-\d+)*$/i; // voucher/account tails, incl. "ID:000..." (OSDE drift)

export function normalizeMerchant(description: string): string {
  let s = description.trim().replace(PREFIX_RE, "");
  s = s.replace(/[._*]+/g, " ");     // punctuation drift: "HELP_HBOMAX_COM" ~ "HELP.HBOMAX.COM"
  s = s.replace(USD_TAIL_RE, "");
  s = s.replace(NUM_TAIL_RE, "");
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

export function loadRules(): Rule[] {
  const p = path.join(DATA_DIR, "merchant-categories.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).rules as Rule[];
}

export function categorize(
  description: string,
  section: string,
  rules: Rule[]
): { category: Category; subcategory: string | null } {
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

Note: `[._*] → space` runs *before* the USD-tail strip, so rules use spaced forms. Known limit (rev note 7): truncated bank strings (`HELP HBOM`) still split merchants for *recurring grouping*; the alias map that fully solves identity is Phase 2 — don't bolt regexes onto this file chasing it.

`data/merchant-categories.json` (seed — **ordered**, first match wins; grows over time, manual overrides live here, spec §7):
```json
{
  "rules": [
    { "match": "MOVISTAR AR", "category": "entertainment", "subcategory": "events" },
    { "match": "MOVISTAR", "category": "services", "subcategory": "phone" },
    { "match": "SPOTIFY", "category": "subscriptions", "subcategory": "music" },
    { "match": "HBOM", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "PRIMEVIDEO", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "YOUTUBEPREMIUM", "category": "subscriptions", "subcategory": "streaming" },
    { "match": "APPLE COM/BILL", "category": "subscriptions", "subcategory": "apps" },
    { "match": "STEAMGAMES", "category": "entertainment", "subcategory": "games" },
    { "match": "DIGITALOCEAN", "category": "services", "subcategory": "hosting" },
    { "match": "PEDIDOSYA", "category": "food", "subcategory": "delivery" },
    { "match": "RAPPI", "category": "food", "subcategory": "delivery" },
    { "match": "OSDE", "category": "health", "subcategory": "insurance" },
    { "match": "FARMACIA", "category": "health", "subcategory": "pharmacy" },
    { "match": "FARMACITY", "category": "health", "subcategory": "pharmacy" },
    { "match": "SANCOR", "category": "health", "subcategory": "insurance" },
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
    { "match": "JUMBO", "category": "food", "subcategory": "supermarket" },
    { "match": "OREGON HOTEL", "category": "shopping", "subcategory": "home" },
    { "match": "HOTEL", "category": "travel", "subcategory": "lodging" },
    { "match": "AEROLINEAS", "category": "travel", "subcategory": "flights" },
    { "match": "DESPEGAR", "category": "travel", "subcategory": "flights" },
    { "match": "TIENDANEWSAN", "category": "shopping", "subcategory": "electronics" },
    { "match": "WHIRLPOOL", "category": "shopping", "subcategory": "appliances" }
  ]
}
```
(`OREGON HOTEL` before `HOTEL`: real data has a 12-cuota bedsheet merchant named "OREGON HOTEL _ SBANAS" — eyeball new `includes()` rules after each real ingest.)

- [x] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/categorize.test.ts` — Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/categorize.ts web/src/lib/categorize.test.ts data/merchant-categories.json
git commit -m "feat: merchant normalization and ordered rule categorization"
```

---

### Task 4: Statement integrity check (`integrity.ts`)

**Files:**
- Create: `web/src/lib/integrity.ts`
- Test: `web/src/lib/integrity.test.ts`

**Interfaces:**
- Produces: `type Alert = { kind: "math_mismatch" | "balance_mismatch"; message: string; expected: number; actual: number }`; `checkStatement(json: StatementJson): Alert[]`; and the **shared** `type StatementJson` (single source of truth for the raw-JSON shape — Task 5's ingest imports it from here). Tolerance: `|diff| <= 1` peso.
- Validated against all 27 real files during review: declared `TOTAL CONSUMOS…` per-block totals match summed purchases *including negatives* — 0 false positives. Keep negatives in the sum.

- [x] **Step 1: Write the failing test**

`web/src/lib/integrity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkStatement, type StatementJson } from "@/lib/integrity";

const base = {
  file: "x.json", brand: "visa",
  period: { closing_date: "2026-07-30", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 150 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS DE JUAN PEREZ", block: 1, ars: 60, usd: null },
    { concept: "SALDO ACTUAL", block: null, ars: 150, usd: null },
  ],
  upcoming_installments: [],
  transactions: [
    { section: "purchases", block: 1, date: "2026-07-10", description: "A", ars: 100, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-11", description: "A REVERSAL", ars: -40, usd: null, installment_number: null, installment_count: null },
  ],
} satisfies StatementJson;

describe("checkStatement", () => {
  it("passes when declared block total matches net (incl. negative) purchases", () => {
    expect(checkStatement(base)).toEqual([]);
  });
  it("flags mismatch beyond 1 peso tolerance", () => {
    const bad = structuredClone(base);
    bad.transactions[0].ars = 95;
    const alerts = checkStatement(bad);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "math_mismatch", expected: 60, actual: 55 });
  });
  it("flags SALDO ACTUAL vs balances mismatch", () => {
    const bad = structuredClone(base);
    bad.balances!.current_ars = 999;
    expect(checkStatement(bad).some(a => a.kind === "balance_mismatch")).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/integrity.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/integrity.ts`:
```ts
// Shared shape of the pdf_to_json output. Single source of truth — ingest imports it.
export type StatementJson = {
  file: string;
  brand: string;
  period: { closing_date: string; due_date?: string; previous_closing_date?: string | null };
  balances?: { current_ars?: number | null; current_usd?: number | null; minimum_payment_ars?: number | null };
  declared_totals?: { concept: string; block: number | null; ars: number | null; usd: number | null }[];
  upcoming_installments?: { month: string; amount_ars: number }[];
  transactions: {
    section: string;
    block?: number | null;
    date: string | null;
    description: string;
    ars: number | null;
    usd: number | null;
    installment_number: number | null;
    installment_count: number | null;
  }[];
};

export type Alert = {
  kind: "math_mismatch" | "balance_mismatch";
  message: string;
  expected: number;
  actual: number;
};

const TOLERANCE = 1; // pesos

export function checkStatement(json: StatementJson): Alert[] {
  const alerts: Alert[] = [];
  for (const dt of json.declared_totals ?? []) {
    if (dt.concept.startsWith("TOTAL CONSUMOS") && dt.block != null && dt.ars != null) {
      const actual = json.transactions
        .filter(t => t.section === "purchases" && t.block === dt.block)
        .reduce((s, t) => s + (t.ars ?? 0), 0);
      if (Math.abs(actual - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "math_mismatch",
          message: `${json.file} block ${dt.block}: declared ${dt.ars} vs summed ${actual.toFixed(2)}`,
          expected: dt.ars, actual: Math.round(actual * 100) / 100,
        });
      }
    }
    if (dt.concept === "SALDO ACTUAL" && dt.ars != null && json.balances?.current_ars != null) {
      if (Math.abs(json.balances.current_ars - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "balance_mismatch",
          message: `${json.file}: SALDO ACTUAL ${dt.ars} vs balances.current_ars ${json.balances.current_ars}`,
          expected: dt.ars, actual: json.balances.current_ars,
        });
      }
    }
  }
  return alerts;
}
```

Note: duplicate-charge and amount-jump anomalies are Phase 2 (spec §3); Phase 1 alerts are these integrity checks only, computed **at ingest** (Task 5) and stored in the `alerts` table.

- [x] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/integrity.test.ts` — Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/integrity.ts web/src/lib/integrity.test.ts
git commit -m "feat: statement integrity checks and shared StatementJson type"
```

---

### Task 5: Ingest — cycle month, alerts, CLI (`ingest.ts`, `scripts/ingest.ts`)

**Files:**
- Create: `web/src/lib/ingest.ts`, `web/scripts/ingest.ts`
- Test: `web/src/lib/ingest.test.ts`

**Interfaces:**
- Consumes: `openDb` (T2), `categorize`/`normalizeMerchant`/`loadRules` (T3), `checkStatement`/`StatementJson` (T4).
- Produces:
  - `cycleMonth(closingDate: string, prevClosingDate: string | null): string` — **billing-cycle midpoint month**. A statement closing 2026-07-02 with prev closing 2026-05-28 is the *June* cycle (`"2026-06"`), not July. This is the month key every query uses (rev note 1).
  - `statementToRows(json: StatementJson, rules: Rule[]): { statement: StatementRow; transactions: TxRow[]; installments: { month: string; amount_ars: number }[]; alerts: Alert[] }` — installments with `amount_ars <= 0` filtered here (real files carry `0.0` filler rows).
  - `ingestFile(db, json, rules): void` — delete+reinsert by `file` (idempotent), writes alerts.
  - CLI `npm run ingest` loops `../json/*.json`, names the offending file on parse errors, exits non-zero on failure.

- [x] **Step 1: Write the failing test**

`web/src/lib/ingest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { cycleMonth, statementToRows, ingestFile } from "@/lib/ingest";
import { openDb } from "@/lib/db";
import type { StatementJson } from "@/lib/integrity";
import type { Rule } from "@/lib/categorize";

const rules: Rule[] = [{ match: "OSDE", category: "health", subcategory: "insurance" }];

const fixture = {
  file: "visa_2026_07_30.pdf",
  brand: "visa",
  period: { closing_date: "2026-07-30", due_date: "2026-08-07", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 100120, current_usd: 32.32, minimum_payment_ars: 280310.0 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS DE JUAN PEREZ", block: 1, ars: 100120, usd: 6.99 },
    { concept: "SALDO ACTUAL", block: null, ars: 100120, usd: null },
  ],
  upcoming_installments: [
    { month: "2026-08", amount_ars: 375290.39 },
    { month: "2026-09", amount_ars: 0.0 }, // real filler row — must be dropped
  ],
  transactions: [
    { section: "payments", block: null, date: "2026-07-13", description: "SU PAGO EN PESOS", ars: -3864892.39, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-10", description: "OSDE 000012345678901", ars: 120000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-12", description: "OSDE 000012345678901", ars: -70000, usd: null, installment_number: null, installment_count: null }, // reversal — kept
    { section: "purchases", block: 1, date: "2026-07-11", description: "MERPAGO*TIENDANEWSAN", ars: 50120, usd: null, installment_number: 13, installment_count: 18 },
    { section: "purchases", block: 1, date: "2026-07-09", description: "APPLE.COM/BILL MT8XM2T22USD 6,99", ars: null, usd: 6.99, installment_number: null, installment_count: null }, // USD-only — kept
    { section: "taxes_and_charges", block: null, date: null, description: "IVA RG 4240 21%( 37759,04)", ars: 7929.39, usd: null, installment_number: null, installment_count: null },
  ],
} satisfies StatementJson;

describe("cycleMonth", () => {
  it("keys the cycle by its midpoint, not the closing month", () => {
    expect(cycleMonth("2026-07-30", "2026-07-02")).toBe("2026-07");
    expect(cycleMonth("2026-07-02", "2026-05-28")).toBe("2026-06"); // the June cycle closing July 2
    expect(cycleMonth("2025-10-02", "2025-08-28")).toBe("2025-09");
  });
  it("falls back to closing minus ~15 days when prev missing", () => {
    expect(cycleMonth("2026-07-30", null)).toBe("2026-07");
    expect(cycleMonth("2026-07-02", null)).toBe("2026-06");
  });
});

describe("statementToRows", () => {
  it("maps statement with cycle_month, categorizes, filters zero installments", () => {
    const r = statementToRows(fixture, rules);
    expect(r.statement).toMatchObject({ file: "visa_2026_07_30.pdf", cycle_month: "2026-07" });
    expect(r.transactions).toHaveLength(6);
    expect(r.transactions.find(t => t.description.startsWith("OSDE"))).toMatchObject({ merchant: "OSDE", category: "health" });
    expect(r.installments).toEqual([{ month: "2026-08", amount_ars: 375290.39 }]);
    expect(r.alerts).toEqual([]); // 120000 - 70000 + 50120 = 100120 matches declared
  });
  it("carries integrity alerts", () => {
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    expect(statementToRows(bad, rules).alerts).toHaveLength(1);
  });
});

describe("ingestFile", () => {
  it("is idempotent per file and persists alerts", () => {
    const db = openDb(":memory:");
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    ingestFile(db, bad, rules);
    ingestFile(db, bad, rules);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 6 });
    expect(db.prepare("SELECT COUNT(*) n FROM upcoming_installments").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM alerts").get()).toEqual({ n: 1 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/ingest.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/ingest.ts`:
```ts
import type Database from "better-sqlite3";
import { categorize, normalizeMerchant, type Rule } from "@/lib/categorize";
import { checkStatement, type StatementJson, type Alert } from "@/lib/integrity";

export function cycleMonth(closingDate: string, prevClosingDate: string | null): string {
  const end = new Date(closingDate + "T00:00:00Z").getTime();
  const start = prevClosingDate
    ? new Date(prevClosingDate + "T00:00:00Z").getTime()
    : end - 30 * 86400_000;
  return new Date((start + end) / 2).toISOString().slice(0, 7);
}

export function statementToRows(json: StatementJson, rules: Rule[]) {
  const prev = json.period.previous_closing_date ?? null;
  const statement = {
    file: json.file,
    brand: json.brand,
    closing_date: json.period.closing_date,
    cycle_month: cycleMonth(json.period.closing_date, prev),
    due_date: json.period.due_date ?? null,
    prev_closing_date: prev,
    balance_ars: json.balances?.current_ars ?? null,
    balance_usd: json.balances?.current_usd ?? null,
    minimum_payment_ars: json.balances?.minimum_payment_ars ?? null,
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
  const installments = (json.upcoming_installments ?? [])
    .filter(i => i.amount_ars > 0) // real files carry 0.0 filler rows
    .map(i => ({ month: i.month, amount_ars: i.amount_ars }));
  const alerts: Alert[] = checkStatement(json);
  return { statement, transactions, installments, alerts };
}

export function ingestFile(db: Database.Database, json: StatementJson, rules: Rule[]): void {
  const { statement, transactions, installments, alerts } = statementToRows(json, rules);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM statements WHERE file = ?").run(statement.file);
    const sid = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars)
       VALUES (@file, @brand, @closing_date, @cycle_month, @due_date, @prev_closing_date, @balance_ars, @balance_usd, @minimum_payment_ars)`
    ).run(statement).lastInsertRowid;
    const insTx = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, @section, @date, @description, @merchant, @category, @subcategory, @ars, @usd, @installment_number, @installment_count)`
    );
    for (const t of transactions) insTx.run(sid, t);
    const insUp = db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, ?, ?)");
    for (const i of installments) insUp.run(sid, i.month, i.amount_ars);
    const insAl = db.prepare("INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?, ?, ?, ?, ?)");
    for (const a of alerts) insAl.run(sid, a.kind, a.message, a.expected, a.actual);
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
import type { StatementJson } from "../src/lib/integrity";

async function main() {
  const jsonDir = path.resolve(process.cwd(), "..", "json");
  const db = openDb();
  const rules = loadRules();
  const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json")).sort();
  let alertTotal = 0;
  for (const f of files) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(jsonDir, f), "utf8")) as StatementJson;
      ingestFile(db, json, rules);
    } catch (e) {
      throw new Error(`ingest failed on ${f}: ${(e as Error).message}`);
    }
  }
  alertTotal = (db.prepare("SELECT COUNT(*) n FROM alerts").get() as { n: number }).n;
  console.log(`done: ${files.length} statements, ${alertTotal} integrity alerts`);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [x] **Step 4: Run tests, then real ingest**

Run: `cd web && npx vitest run src/lib/ingest.test.ts` — Expected: PASS.
Run: `cd web && npm run ingest` — Expected: `done: 27 statements, 0 integrity alerts` (review verified 0 mismatches on real data). Sanity: `sqlite3 ../data/app.db "SELECT COUNT(*) FROM transactions"` ≈ 1341; `sqlite3 ../data/app.db "SELECT DISTINCT cycle_month FROM statements ORDER BY 1"` — no doubled months: the four calendar-July-2026 closers land in 2026-06 and 2026-07.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/ingest.ts web/src/lib/ingest.test.ts web/scripts/ingest.ts
git commit -m "feat: ingest with cycle-month keying and ingest-time alerts"
```

---

### Task 6: CPI module + fetcher (`cpi.ts`, `scripts/fetch-ipc.ts`)

**Files:**
- Create: `web/src/lib/cpi.ts`, `web/scripts/fetch-ipc.ts`, `data/ipc.json` (produced by fetcher, committed as cache — spec §6)
- Test: `web/src/lib/cpi.test.ts`

**Interfaces:**
- Produces: `type CpiTable = Record<string, number>` (`"YYYY-MM"` → index); `toReal(amountArs, fromMonth, toMonth, table): number`; `latestMonth(table): string`; `loadCpi(): CpiTable` (module-cached read of `DATA_DIR/ipc.json`; missing file → `Error("data/ipc.json missing — run npm run fetch-ipc")`). Missing month → nearest **earlier** month present; empty table → `Error(".. run npm run fetch-ipc")`. When CPI lags statements (latest cycle newer than latest index), that cycle is effectively undeflated — the UI labels the base month (Task 9) so this is visible, not silent.

- [x] **Step 1: Write the failing test**

`web/src/lib/cpi.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toReal, latestMonth } from "@/lib/cpi";

const table = { "2025-01": 100, "2025-02": 110, "2025-04": 133.1 };

describe("cpi", () => {
  it("deflates by index ratio", () => {
    expect(toReal(1000, "2025-01", "2025-02", table)).toBeCloseTo(1100);
  });
  it("falls back to nearest earlier month (2025-03 missing -> 2025-02)", () => {
    expect(toReal(1000, "2025-03", "2025-04", table)).toBeCloseTo(1210);
  });
  it("latestMonth", () => {
    expect(latestMonth(table)).toBe("2025-04");
  });
  it("throws actionable error on empty table", () => {
    expect(() => toReal(1, "2025-01", "2025-02", {})).toThrow(/fetch-ipc/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/cpi.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/cpi.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

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

let _cpi: CpiTable | undefined;
export function loadCpi(): CpiTable {
  if (_cpi) return _cpi;
  const p = path.join(DATA_DIR, "ipc.json");
  if (!fs.existsSync(p)) throw new Error("data/ipc.json missing — run npm run fetch-ipc");
  return (_cpi = JSON.parse(fs.readFileSync(p, "utf8")) as CpiTable);
}
```

`web/scripts/fetch-ipc.ts` (INDEC IPC nivel general nacional via datos.gob.ar series API):
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
main().catch(e => { console.error(e); process.exit(1); });
```

If the series id 404s, find the current one at `https://datosgobar.github.io/series-tiempo-ar-explorer/` (search "IPC nivel general nacional índice") and swap `SERIES_ID`. Commit the produced `data/ipc.json`.

- [x] **Step 4: Run tests + fetch**

Run: `cd web && npx vitest run src/lib/cpi.test.ts` — Expected: PASS.
Run: `cd web && npm run fetch-ipc` — Expected: `wrote .../data/ipc.json N months, latest: 2026-06` (INDEC publishes ~mid following month).

- [x] **Step 5: Commit**

```bash
git add web/src/lib/cpi.ts web/src/lib/cpi.test.ts web/scripts/fetch-ipc.ts data/ipc.json
git commit -m "feat: CPI deflator with INDEC fetcher and cached table"
```

---

### Task 7: Recurring-charge detection (`recurring.ts`)

**Files:**
- Create: `web/src/lib/recurring.ts`
- Test: `web/src/lib/recurring.test.ts`

**Interfaces:**
- Consumes: rows `{ merchant: string; month: string; ars: number | null; usd: number | null; installment_count?: number | null }` (month = `cycle_month`).
- Produces: `type RecurringCharge = { merchant: string; currency: "ARS" | "USD"; occurrences: number; lastMonth: string; lastAmount: number; prevAmount: number | null; pctChange: number | null; nextExpectedMonth: string }`; `detectRecurring(rows, opts?): RecurringCharge[]`.
- Heuristics (research: Actual Budget): ≥3 distinct months AND ≥60% of the span between first and last appearance. Cuota rows excluded (contractual, not recurring). **Currency-aware** (rev note 3): a row is ARS when `ars > 0`, USD when `ars == null && usd > 0`; grouping key is `merchant|currency`, so Spotify's mid-2025 switch to USD billing shows as two honest rows (stale ARS one, active USD one) instead of a phantom cancellation. `pctChange` on nominal amounts within the same currency — nominal jump IS the price-hike signal (spec §3).

- [x] **Step 1: Write the failing test**

`web/src/lib/recurring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectRecurring } from "@/lib/recurring";

const ars = (merchant: string, month: string, amount: number, installment_count: number | null = null) =>
  ({ merchant, month, ars: amount, usd: null, installment_count });
const usd = (merchant: string, month: string, amount: number) =>
  ({ merchant, month, ars: null, usd: amount, installment_count: null });

describe("detectRecurring", () => {
  it("finds monthly ARS merchant and computes change", () => {
    const r = detectRecurring([ars("OSDE", "2026-04", 5000), ars("OSDE", "2026-05", 5000), ars("OSDE", "2026-06", 6000)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      merchant: "OSDE", currency: "ARS", occurrences: 3, lastMonth: "2026-06",
      lastAmount: 6000, prevAmount: 5000, nextExpectedMonth: "2026-07",
    });
    expect(r[0].pctChange).toBeCloseTo(20);
  });
  it("tracks USD-billed subscriptions separately per currency", () => {
    const rows = [
      ars("SPOTIFY", "2025-03", 4199), ars("SPOTIFY", "2025-04", 4199), ars("SPOTIFY", "2025-05", 4199),
      usd("SPOTIFY", "2025-06", 3.59), usd("SPOTIFY", "2025-07", 3.59), usd("SPOTIFY", "2025-08", 3.73),
    ];
    const r = detectRecurring(rows);
    const currencies = r.map(x => x.currency).sort();
    expect(currencies).toEqual(["ARS", "USD"]);
    expect(r.find(x => x.currency === "USD")!.lastAmount).toBeCloseTo(3.73);
  });
  it("ignores sparse (<60% of span) and <3-month merchants", () => {
    const sparse = [ars("A", "2026-01", 1), ars("A", "2026-04", 1), ars("A", "2026-07", 1)];
    const few = [ars("B", "2026-01", 1), ars("B", "2026-02", 1)];
    expect(detectRecurring([...sparse, ...few])).toHaveLength(0);
  });
  it("excludes cuota rows", () => {
    const rows = [ars("TIENDA", "2026-01", 100, 12), ars("TIENDA", "2026-02", 100, 12), ars("TIENDA", "2026-03", 100, 12)];
    expect(detectRecurring(rows)).toHaveLength(0);
  });
  it("sums same-merchant same-month rows", () => {
    const rows = [ars("OSDE", "2026-04", 100), ars("OSDE", "2026-04", 50), ars("OSDE", "2026-05", 150), ars("OSDE", "2026-06", 150)];
    const r = detectRecurring(rows);
    expect(r[0].lastAmount).toBe(150);
    expect(r[0].occurrences).toBe(3);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/recurring.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/recurring.ts`:
```ts
export type RecurringCharge = {
  merchant: string;
  currency: "ARS" | "USD";
  occurrences: number;
  lastMonth: string;
  lastAmount: number;
  prevAmount: number | null;
  pctChange: number | null;
  nextExpectedMonth: string;
};

type Row = { merchant: string; month: string; ars: number | null; usd: number | null; installment_count?: number | null };

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1; // inclusive span
}

function addMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7); // mo is 0-indexed next month
}

export function detectRecurring(
  rows: Row[],
  opts: { minMonths?: number; minDensity?: number } = {}
): RecurringCharge[] {
  const { minMonths = 3, minDensity = 0.6 } = opts;
  const groups = new Map<string, Map<string, number>>(); // "merchant|currency" -> month -> summed amount
  for (const r of rows) {
    if (r.installment_count != null) continue;
    let currency: "ARS" | "USD"; let amount: number;
    if (r.ars != null && r.ars > 0) { currency = "ARS"; amount = r.ars; }
    else if (r.ars == null && r.usd != null && r.usd > 0) { currency = "USD"; amount = r.usd; }
    else continue;
    const key = `${r.merchant}|${currency}`;
    const months = groups.get(key) ?? new Map();
    months.set(r.month, (months.get(r.month) ?? 0) + amount);
    groups.set(key, months);
  }
  const out: RecurringCharge[] = [];
  for (const [key, months] of groups) {
    const [merchant, currency] = key.split("|") as [string, "ARS" | "USD"];
    const sorted = [...months.keys()].sort();
    if (sorted.length < minMonths) continue;
    const span = monthsBetween(sorted[0], sorted[sorted.length - 1]);
    if (sorted.length / span < minDensity) continue;
    const lastMonth = sorted[sorted.length - 1];
    const prevMonth = sorted[sorted.length - 2];
    const lastAmount = months.get(lastMonth)!;
    const prevAmount = prevMonth ? months.get(prevMonth)! : null;
    out.push({
      merchant, currency,
      occurrences: sorted.length,
      lastMonth, lastAmount, prevAmount,
      pctChange: prevAmount ? ((lastAmount - prevAmount) / prevAmount) * 100 : null,
      nextExpectedMonth: addMonth(lastMonth),
    });
  }
  return out.sort((a, b) => (a.currency === b.currency ? b.lastAmount - a.lastAmount : a.currency === "ARS" ? -1 : 1));
}
```

Known limit (rev note 7): drifted/truncated merchant strings still split groups (e.g. `HELP HBOM` vs `HELP HBOMAX COM`) — density may then fail for genuinely recurring merchants. The alias map is the Phase 2 fix; do not tune density down to compensate.

- [x] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/recurring.test.ts` — Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/recurring.ts web/src/lib/recurring.test.ts
git commit -m "feat: currency-aware recurring charge detection"
```

---

### Task 8: Query layer (`queries.ts`)

**Files:**
- Create: `web/src/lib/queries.ts`
- Test: `web/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `openDb` (T2), `toReal`/`latestMonth` (T6), `detectRecurring` (T7).
- Produces:
  - `type SpendMode = "cash" | "accrual"`; `type ValueMode = "nominal" | "real"`; `type ValueOpts = { spend: SpendMode; value: ValueMode; cpi: CpiTable }`
  - `monthlySpendByCategory(db, opts): { month: string; category: string; amount: number }[]`
  - `categoryDrill(db, opts, filter: { category?: string; subcategory?: string; month?: string }): { level: "category" | "subcategory" | "merchant"; rows: DrillRow[]; groups: { key: string; amount: number }[] }` where `DrillRow = { month: string; date: string | null; description: string; merchant: string; category: string; subcategory: string | null; amount: number | null; usd: number | null }` — `amount` is the **computed** value (mode-dependent), deliberately not named `ars`; `null` for USD-only rows (which still appear in `rows`, showing their `usd`).
  - `recurringTable(db): RecurringCharge[]`
  - `periodComparison(db, opts, granularity: "month" | "quarter" | "year"): { period: string; amount: number; pctVsPrev: number | null }[]`
  - `coverage(db): { month: string; brands: string[] }[]` — which brands have a statement per cycle month (for the comparison footnote, rev note 9)
  - `eli5(db, opts): { spentThisMonth: number; pctVsPrev: number | null; committedNextMonth: number; topCategories: { category: string; amount: number }[]; alerts: { kind: string; message: string }[]; cuotaMonths: number; cuotaTotal: number; sparkline: { month: string; amount: number }[]; latestClosing: string; nextDueDate: string | null; baseMonth: string }` — throws `Error("No statements ingested — run npm run ingest")` on empty DB; honors **both** modes (rev note 10); cuota tiles aggregate latest statement **per brand**.
- **Spend semantics** (rev notes 2–4): base rows = `section='purchases' AND (ars != 0 OR (ars IS NULL AND usd > 0))` — negatives net, USD-only rows ride along. ARS aggregates skip `ars IS NULL` rows. `accrual`: per cuota series (key `merchant|installment_count`) find the **minimum observed** `installment_number` k; the k-row counts as `ars × (count − k + 1)` (remaining principal — full price when k=1), all other cuota rows excluded. `real`: deflate from `cycle_month` to `latestMonth(cpi)` (resolved **once** per query call, not per row). Month = `statements.cycle_month`.

- [x] **Step 1: Write the failing test**

`web/src/lib/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { monthlySpendByCategory, categoryDrill, periodComparison, eli5, coverage } from "@/lib/queries";

const cpi = { "2026-06": 100, "2026-07": 110 };

function seed(db: Database.Database) {
  const ins = db.prepare(
    `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date) VALUES (?, ?, ?, ?, ?)`
  );
  const s1 = ins.run("v_2026_06.json", "visa", "2026-06-26", "2026-06", "2026-07-07").lastInsertRowid;
  const s2 = ins.run("v_2026_07.json", "visa", "2026-07-30", "2026-07", "2026-08-07").lastInsertRowid;
  const s3 = ins.run("m_2026_07.json", "mastercard", "2026-07-30", "2026-07", "2026-08-10").lastInsertRowid;
  const tx = db.prepare(
    `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
     VALUES (?, 'purchases', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // June visa: food 1000
  tx.run(s1, "2026-06-10", "COTO", "COTO", "food", null, 1000, null, null, null);
  // July visa: food 1000; refund -200 (netting); headless cuota series seen from 3/6 (remaining 4×100=400); USD-only sub
  tx.run(s2, "2026-07-10", "COTO", "COTO", "food", null, 1000, null, null, null);
  tx.run(s2, "2026-07-12", "COTO DEVOL", "COTO", "food", null, -200, null, null, null);
  tx.run(s2, "2026-07-11", "MERPAGO*TIENDA", "TIENDA", "shopping", "electronics", 100, null, 3, 6);
  tx.run(s2, "2026-07-09", "Spotify USD 3,73", "SPOTIFY", "subscriptions", "music", null, 3.73, null, null);
  // July mastercard: transport 500
  tx.run(s3, "2026-07-15", "YPF", "YPF", "transport", "fuel", 500, null, null, null);
  const up = db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, ?, ?)");
  up.run(s2, "2026-08", 200); up.run(s2, "2026-09", 100);
  up.run(s3, "2026-08", 50);
}

describe("queries", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(":memory:"); seed(db); });

  it("accrual counts remaining principal at first-observed cuota, nets refunds, skips USD-only in sums", () => {
    const r = monthlySpendByCategory(db, { spend: "accrual", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 400, transport: 500 }); // 1000-200; 100×(6-3+1); no subscriptions key
  });

  it("cash sums as billed", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 100, transport: 500 });
  });

  it("real mode deflates June to July pesos", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "real", cpi });
    expect(r.find(x => x.month === "2026-06" && x.category === "food")!.amount).toBeCloseTo(1100);
  });

  it("drill returns level, groups, and keeps USD-only rows visible with null amount", () => {
    const top = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, {});
    expect(top.level).toBe("category");
    expect(top.groups.find(g => g.key === "food")!.amount).toBe(1800); // both months
    const subs = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, { category: "subscriptions" });
    expect(subs.level).toBe("subcategory");
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]).toMatchObject({ amount: null, usd: 3.73 });
    const merch = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, { category: "food", subcategory: "(none)" });
    expect(merch.level).toBe("merchant");
  });

  it("periodComparison computes real deltas", () => {
    const r = periodComparison(db, { spend: "cash", value: "real", cpi }, "month");
    expect(r.map(x => x.period)).toEqual(["2026-06", "2026-07"]);
    expect(r[1].pctVsPrev).toBeCloseTo(((1400 - 1100) / 1100) * 100); // july cash: 800+100+500
  });

  it("coverage reports brands per month", () => {
    expect(coverage(db)).toEqual([
      { month: "2026-06", brands: ["visa"] },
      { month: "2026-07", brands: ["mastercard", "visa"] },
    ]);
  });

  it("eli5 aggregates cuotas across latest statement per brand and honors modes", () => {
    const t = eli5(db, { spend: "cash", value: "real", cpi });
    expect(t.spentThisMonth).toBeCloseTo(1400);
    expect(t.committedNextMonth).toBe(250); // 200 visa + 50 mastercard
    expect(t.cuotaMonths).toBe(2);
    expect(t.cuotaTotal).toBe(350);
    expect(t.baseMonth).toBe("2026-07");
    expect(t.alerts).toEqual([]);
    const nom = eli5(db, { spend: "cash", value: "nominal", cpi });
    expect(nom.sparkline.find(s => s.month === "2026-06")!.amount).toBe(1000); // nominal honored
  });

  it("eli5 throws actionable error on empty DB", () => {
    const empty = openDb(":memory:");
    expect(() => eli5(empty, { spend: "cash", value: "real", cpi })).toThrow(/npm run ingest/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/queries.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

`web/src/lib/queries.ts`:
```ts
import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";

export type SpendMode = "cash" | "accrual";
export type ValueMode = "nominal" | "real";
export type ValueOpts = { spend: SpendMode; value: ValueMode; cpi: CpiTable };

type BaseRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

function baseRows(db: Database.Database): BaseRow[] {
  // Negatives net against spend; USD-only rows ride along for drill/recurring (rev notes 2-3).
  return db.prepare(`
    SELECT s.cycle_month AS month, t.date, t.description, t.merchant,
           t.category, t.subcategory, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' AND (t.ars != 0 OR (t.ars IS NULL AND t.usd > 0))
    ORDER BY s.cycle_month, t.date
  `).all() as BaseRow[];
}

type AmountCtx = { baseMonth: string; minK: Map<string, number> };

function amountCtx(rows: BaseRow[], opts: ValueOpts): AmountCtx {
  const minK = new Map<string, number>();
  for (const r of rows) {
    if (r.installment_count == null || r.installment_number == null) continue;
    const key = `${r.merchant}|${r.installment_count}`;
    const cur = minK.get(key);
    if (cur === undefined || r.installment_number < cur) minK.set(key, r.installment_number);
  }
  return { baseMonth: latestMonth(opts.cpi), minK };
}

// The single home of cash/accrual/real semantics. Returns null when the row
// doesn't contribute to ARS aggregates in this mode (USD-only, or a non-first cuota in accrual).
function effectiveAmount(r: BaseRow, opts: ValueOpts, ctx: AmountCtx): number | null {
  if (r.ars == null) return null; // USD-only: visible in drill rows, never in ARS sums
  let amt = r.ars;
  if (opts.spend === "accrual" && r.installment_count != null && r.installment_number != null) {
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}`)!;
    if (r.installment_number !== k) return null;
    amt = r.ars * (r.installment_count - k + 1); // remaining principal; full price when k=1 (rev note 4)
  }
  if (opts.value === "real") amt = toReal(amt, r.month, ctx.baseMonth, opts.cpi);
  return amt;
}

export function monthlySpendByCategory(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const key = `${r.month}|${r.category}`;
    acc.set(key, (acc.get(key) ?? 0) + amt);
  }
  return [...acc.entries()]
    .map(([k, amount]) => { const [month, category] = k.split("|"); return { month, category, amount }; })
    .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
}

export type DrillRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; amount: number | null; usd: number | null;
};

export function categoryDrill(
  db: Database.Database, opts: ValueOpts,
  filter: { category?: string; subcategory?: string; month?: string }
) {
  const level: "category" | "subcategory" | "merchant" =
    !filter.category ? "category" : !filter.subcategory ? "subcategory" : "merchant";
  const all = baseRows(db);
  const ctx = amountCtx(all, opts);
  const rows: DrillRow[] = [];
  const groups = new Map<string, number>();
  for (const r of all) {
    if (filter.category && r.category !== filter.category) continue;
    if (filter.subcategory && (r.subcategory ?? "(none)") !== filter.subcategory) continue;
    if (filter.month && r.month !== filter.month) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null && r.usd == null) continue; // dropped by mode (non-first cuota in accrual)
    rows.push({ month: r.month, date: r.date, description: r.description, merchant: r.merchant,
      category: r.category, subcategory: r.subcategory, amount: amt, usd: r.usd });
    if (amt != null) {
      const key = level === "category" ? r.category : level === "subcategory" ? (r.subcategory ?? "(none)") : r.merchant;
      groups.set(key, (groups.get(key) ?? 0) + amt);
    }
  }
  return {
    level,
    rows: rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    groups: [...groups.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function recurringTable(db: Database.Database): RecurringCharge[] {
  return detectRecurring(baseRows(db));
}

export function periodComparison(
  db: Database.Database, opts: ValueOpts, granularity: "month" | "quarter" | "year"
) {
  const rows = baseRows(db);
  const ctx = amountCtx(rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
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

export function coverage(db: Database.Database): { month: string; brands: string[] }[] {
  const rows = db.prepare(
    "SELECT cycle_month AS month, GROUP_CONCAT(DISTINCT brand) AS b FROM statements GROUP BY cycle_month ORDER BY cycle_month"
  ).all() as { month: string; b: string }[];
  return rows.map(r => ({ month: r.month, brands: r.b.split(",").sort() }));
}

export function eli5(db: Database.Database, opts: ValueOpts) {
  const months = monthlySpendByCategory(db, opts);
  if (months.length === 0) throw new Error("No statements ingested — run npm run ingest");
  const byMonth = new Map<string, number>();
  for (const m of months) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.amount);
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const [lastMonthKey, spentThisMonth] = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2][1] : null;

  // Latest statement per brand — two cards close the same day; LIMIT 1 would drop one (rev note 10).
  const latestPerBrand = db.prepare(`
    SELECT s.id, s.closing_date, s.due_date FROM statements s
    JOIN (SELECT brand, MAX(closing_date) mc FROM statements GROUP BY brand) x
      ON x.brand = s.brand AND x.mc = s.closing_date
  `).all() as { id: number; closing_date: string; due_date: string | null }[];
  const ids = latestPerBrand.map(s => s.id);
  const upcoming = db.prepare(
    `SELECT month, SUM(amount_ars) amount FROM upcoming_installments
     WHERE statement_id IN (${ids.map(() => "?").join(",")}) GROUP BY month ORDER BY month`
  ).all(...ids) as { month: string; amount: number }[];

  const alerts = db.prepare("SELECT kind, message FROM alerts ORDER BY id DESC LIMIT 5")
    .all() as { kind: string; message: string }[];

  const latest = latestPerBrand.sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];

  return {
    spentThisMonth,
    pctVsPrev: prev ? ((spentThisMonth - prev) / prev) * 100 : null,
    committedNextMonth: upcoming[0]?.amount ?? 0,
    topCategories: months.filter(m => m.month === lastMonthKey)
      .sort((a, b) => b.amount - a.amount).slice(0, 3)
      .map(m => ({ category: m.category, amount: m.amount })),
    alerts,
    cuotaMonths: upcoming.length,
    cuotaTotal: upcoming.reduce((s, u) => s + u.amount, 0),
    sparkline: sorted.slice(-12).map(([month, amount]) => ({ month, amount })),
    latestClosing: latest.closing_date,
    nextDueDate: latest.due_date,
    baseMonth: latestMonth(opts.cpi),
  };
}
```

- [x] **Step 4: Run full test suite**

Run: `cd web && npm test` — Expected: ALL PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts
git commit -m "feat: query layer with netting, cuota remaining-principal, per-brand cuotas"
```

---

### Task 9: UI shell — layout, nav, mode toggles, formatting

**Files:**
- Create: `web/src/lib/format.ts`, `web/src/lib/params.ts`, `web/src/components/ModeToggle.tsx`, `web/src/components/Nav.tsx`
- Modify: `web/src/app/layout.tsx`
- Test: `web/src/lib/format.test.ts`, `web/src/lib/params.test.ts`

**Interfaces:**
- Produces:
  - `fmtArs(n: number): string` (es-AR currency, 0 decimals); `fmtPct(n: number | null): string` (`"+12,3%"` / `"−4,1%"` / `"—"`)
  - `parseModes(searchParams): { spend: SpendMode; value: ValueMode }` (defaults `{ spend: "accrual", value: "real" }`, junk falls back)
  - `withModes(path: string, modes: { spend: string; value: string }, extra?: Record<string, string>): string` — builds hrefs that **preserve** modes (rev: bare links silently reset toggles)
  - `<ModeToggle spend value baseMonth?/>` client component writing `?value=`/`?spend=` via router; shows "in <baseMonth> pesos" when value=real and baseMonth given
  - `<Nav />` client component that preserves current search params across links: `/` Overview, `/trends`, `/categories`, `/recurring`, `/compare`.

- [x] **Step 1: Write the failing tests**

`web/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fmtArs, fmtPct } from "@/lib/format";

describe("format", () => {
  it("formats ARS es-AR, no decimals", () => {
    expect(fmtArs(1234567.89).replace(/ /g, " ")).toBe("$ 1.234.568");
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
import { parseModes, withModes } from "@/lib/params";

describe("parseModes", () => {
  it("defaults to accrual + real", () => {
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real" });
  });
  it("reads valid params, rejects junk", () => {
    expect(parseModes({ spend: "cash", value: "nominal" })).toEqual({ spend: "cash", value: "nominal" });
    expect(parseModes({ spend: "bogus", value: "nominal" })).toEqual({ spend: "accrual", value: "nominal" });
  });
});

describe("withModes", () => {
  it("builds hrefs preserving modes plus extras", () => {
    expect(withModes("/trends", { spend: "cash", value: "nominal" }))
      .toBe("/trends?spend=cash&value=nominal");
    expect(withModes("/compare", { spend: "cash", value: "real" }, { g: "quarter" }))
      .toBe("/compare?spend=cash&value=real&g=quarter");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/format.test.ts src/lib/params.test.ts` — Expected: FAIL.

- [x] **Step 3: Implement**

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

export function withModes(
  path: string,
  modes: { spend: string; value: string },
  extra: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ spend: modes.spend, value: modes.value, ...extra });
  return `${path}?${q.toString()}`;
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

export function ModeToggle({ spend, value, baseMonth }: { spend: string; value: string; baseMonth?: string }) {
  return (
    <div className="flex items-center gap-3">
      {value === "real" && baseMonth && (
        <span className="text-xs text-zinc-500">in {baseMonth} pesos</span>
      )}
      <Seg param="value" current={value} options={[["real", "Real $"], ["nominal", "Nominal $"]]} />
      <Seg param="spend" current={spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
    </div>
  );
}
```

`web/src/components/Nav.tsx` (client, preserves modes across navigation):
```tsx
"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const links = [
  ["/", "Overview"], ["/trends", "Trends"], ["/categories", "Categories"],
  ["/recurring", "Recurring"], ["/compare", "Compare"],
] as const;

export function Nav() {
  const sp = useSearchParams();
  const qs = sp.toString();
  return (
    <nav className="flex gap-4 py-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
      {links.map(([href, label]) => (
        <Link key={href} href={qs ? `${href}?${qs}` : href} className="text-sm font-medium hover:underline">
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

`web/src/app/layout.tsx` (Nav uses `useSearchParams` → wrap in Suspense):
```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Tarjetas", description: "Credit card statement analysis" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="max-w-5xl mx-auto px-4 antialiased">
        <Suspense><Nav /></Suspense>
        {children}
      </body>
    </html>
  );
}
```

- [x] **Step 4: Run tests + build**

Run: `cd web && npm test` — Expected: PASS. Run: `npm run build` — Expected: success.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/format.ts web/src/lib/format.test.ts web/src/lib/params.ts web/src/lib/params.test.ts web/src/components web/src/app/layout.tsx
git commit -m "feat: UI shell with mode-preserving nav and toggles"
```

---

### Task 10: ELI5 overview page (`/`)

**Files:**
- Create: `web/src/components/Sparkline.tsx`
- Modify: `web/src/app/page.tsx` (replace scaffold content)

**Interfaces:**
- Consumes: `eli5`/`getDb` (T2/T8), `loadCpi` (T6), `parseModes`/`withModes`/`fmtArs`/`fmtPct` (T9), `ModeToggle` (T9).
- Produces: 6 tiles per spec §4. Five link to deep views **preserving modes**; the Alerts tile is a non-link that shows the actual messages (no dead-end navigation).

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
import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { eli5 } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
import { fmtArs, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Sparkline } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

function Tile({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  const cls = "block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4";
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      {children}
    </>
  );
  return href
    ? <Link href={href} className={`${cls} hover:shadow-md transition-shadow`}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const t = eli5(getDb(), { ...modes, cpi: loadCpi() });
  const valueLabel = modes.value === "real" ? "real" : "nominal";
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Statement {t.latestClosing}</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={t.baseMonth} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Tile href={withModes("/trends", modes)} label={`Spent this statement (${valueLabel})`}>
          <div className="text-2xl font-bold">{fmtArs(t.spentThisMonth)}</div>
          <div className="text-sm text-zinc-500">{fmtPct(t.pctVsPrev)} vs last month</div>
        </Tile>
        <Tile href={withModes("/recurring", modes)} label="Committed next month">
          <div className="text-2xl font-bold">{fmtArs(t.committedNextMonth)}</div>
          <div className="text-sm text-zinc-500">due after {t.nextDueDate ?? "—"}</div>
        </Tile>
        <Tile href={withModes("/categories", modes)} label="Top categories">
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span>{c.category}</span><span>{fmtArs(c.amount)}</span>
            </div>
          ))}
        </Tile>
        <Tile label="Alerts">
          <div className="text-2xl font-bold">{t.alerts.length}</div>
          {t.alerts.length === 0
            ? <div className="text-sm text-zinc-500">statements add up</div>
            : t.alerts.map((a, i) => <div key={i} className="text-xs text-red-600">{a.message}</div>)}
        </Tile>
        <Tile href={withModes("/compare", modes)} label="Cuota burden (both cards)">
          <div className="text-2xl font-bold">{fmtArs(t.cuotaTotal)}</div>
          <div className="text-sm text-zinc-500">over next {t.cuotaMonths} months</div>
        </Tile>
        <Tile href={withModes("/trends", modes)} label={`12-month trend (${valueLabel})`}>
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `cd web && npm run dev`, open `http://localhost:3000`. Expected: 6 tiles with real numbers; both toggles change tile values; "in 2026-06 pesos" (or latest CPI month) label visible in real mode; tile links keep the chosen modes; alerts tile shows "statements add up" (0 expected on real data).

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
- Consumes: `monthlySpendByCategory`, `periodComparison`, `coverage` (T8); `Category`/`CATEGORIES` (T3); shell (T9).
- Produces: `CATEGORY_COLORS: Record<Category, string>` — typed against the taxonomy so a new category without a color is a compile error.

- [ ] **Step 1: Implement**

`web/src/lib/colors.ts`:
```ts
import type { Category } from "@/lib/categorize";

export const CATEGORY_COLORS: Record<Category, string> = {
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
import type { Category } from "@/lib/categorize";
import { fmtArs } from "@/lib/format";

export function StackedArea({ data, categories }: {
  data: Record<string, number | string>[]; categories: Category[];
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
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { monthlySpendByCategory } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import type { Category } from "@/lib/categorize";
import { ModeToggle } from "@/components/ModeToggle";
import { StackedArea } from "@/components/StackedArea";

export const dynamic = "force-dynamic";

export default async function Trends({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const cpi = loadCpi();
  const rows = monthlySpendByCategory(getDb(), { ...modes, cpi });
  const categories = [...new Set(rows.map(r => r.category))].sort() as Category[];
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { month: r.month };
    m[r.category] = r.amount;
    byMonth.set(r.month, m);
  }
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Monthly spend by category</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <StackedArea data={[...byMonth.values()]} categories={categories} />
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
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CompareBars } from "@/components/CompareBars";

export const dynamic = "force-dynamic";

export default async function Compare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
  const db = getDb();
  const cpi = loadCpi();
  const data = periodComparison(db, { ...modes, cpi }, g);
  const singleCard = coverage(db).filter(c => c.brands.length === 1);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Period comparison</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <div className="flex gap-2 mb-4 text-sm">
        {(["month", "quarter", "year"] as const).map(x => (
          <Link key={x} href={withModes("/compare", modes, { g: x })}
            className={x === g ? "font-bold underline" : "hover:underline"}>{x}</Link>
        ))}
      </div>
      <CompareBars data={data} />
      {singleCard.length > 0 && (
        <p className="text-xs text-zinc-500 mt-3">
          ⚠ Single-card months (missing statements for one brand): {singleCard.map(c => c.month).join(", ")} — comparisons across these are apples-to-oranges.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

`/trends`: stacked area, no doubled/empty months (cycle-month fix visible: 2026-06 populated). Toggle to nominal → steep inflation slope. `/compare`: granularity switch preserves modes; single-card months footnote lists the mastercard gaps.

- [ ] **Step 3: Build + commit**

Run: `cd web && npm run build` — Expected: success.

```bash
git add web/src/app/trends web/src/app/compare web/src/components/StackedArea.tsx web/src/components/CompareBars.tsx web/src/lib/colors.ts
git commit -m "feat: trends and period comparison charts with coverage footnote"
```

---

### Task 12: Categories drill page (chart 5) + Recurring page (chart 6)

**Files:**
- Create: `web/src/app/categories/page.tsx`, `web/src/app/recurring/page.tsx`, `web/src/components/DrillBars.tsx`

**Interfaces:**
- Consumes: `categoryDrill` (returns `level` — page does not re-derive it), `recurringTable` (T8), `CATEGORY_COLORS` (T11), shell (T9).
- Produces: drill URL scheme `/categories?category=food&subcategory=delivery` — bar click descends one level; breadcrumb clears levels; modes preserved throughout.

- [ ] **Step 1: Implement**

`web/src/components/DrillBars.tsx`:
```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CATEGORY_COLORS } from "@/lib/colors";
import type { Category } from "@/lib/categorize";
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
        {/* Recharts' onClick payload typings are unusable; single narrow cast, blame recharts */}
        <Bar dataKey="amount" onClick={(d) => onClick((d as { key: string }).key)} cursor={level === "merchant" ? "default" : "pointer"}>
          {groups.map(g => (
            <Cell key={g.key} fill={CATEGORY_COLORS[g.key as Category] ?? "#0ea5e9"} />
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
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { categoryDrill } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
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
  const cpi = loadCpi();
  const { level, rows, groups } = categoryDrill(getDb(), { ...modes, cpi }, filter);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Categories</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <div className="text-sm mb-4 flex gap-2">
        <Link href={withModes("/categories", modes)} className="hover:underline">all</Link>
        {filter.category && <><span>/</span><Link href={withModes("/categories", modes, { category: filter.category })} className="hover:underline">{filter.category}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
      </div>
      <DrillBars groups={groups} level={level} />
      {level !== "category" && (
        <table className="w-full text-sm mt-6">
          <thead><tr className="text-left text-zinc-500">
            <th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">USD</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                <td>{r.description}</td>
                <td className="text-right">{r.amount != null ? fmtArs(r.amount) : "—"}</td>
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
import { getDb } from "@/lib/db";
import { recurringTable } from "@/lib/queries";
import { fmtArs, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Recurring() {
  const rows = recurringTable(getDb());
  return (
    <main>
      <h1 className="text-xl font-semibold mb-4">Recurring charges</h1>
      <p className="text-sm text-zinc-500 mb-4">Nominal amounts — % change vs previous month is the inflation/price-hike signal. USD-billed subscriptions tracked separately.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">Merchant</th><th>Currency</th><th className="text-right">Months seen</th>
          <th className="text-right">Last amount</th><th className="text-right">Change</th>
          <th className="text-right">Next expected</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.merchant}|${r.currency}`} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1">{r.merchant}</td>
              <td>{r.currency}</td>
              <td className="text-right">{r.occurrences}</td>
              <td className="text-right">{r.currency === "ARS" ? fmtArs(r.lastAmount) : `US$ ${r.lastAmount.toFixed(2)}`}</td>
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

`/categories`: bars by category → click food → subcategories → merchants + tx table (USD-only rows show "—" amount + USD value). `/recurring`: OSDE unified (ID: drift fixed), Spotify shows an ARS row *and* a USD row, >10% nominal jumps red. Known: HBO Max may still split/miss (alias map is Phase 2 — don't chase it here).

- [ ] **Step 3: Full suite + build + commit**

Run: `cd web && npm test && npm run build` — Expected: ALL PASS + build success.

```bash
git add web/src/app/categories web/src/app/recurring web/src/components/DrillBars.tsx
git commit -m "feat: category drill and recurring charges pages"
```

---

## Phase 1 Done Criteria

- `npm run ingest` idempotently loads 27 statements (~1341 tx), 0 integrity alerts, no doubled cycle months.
- `npm test` green; `npm run build` clean.
- `/` shows 6 live tiles (alerts tile lists messages inline); `/trends`, `/categories` (3-level drill + tx table incl. USD rows), `/recurring` (currency column), `/compare` (coverage footnote) all render real data.
- Real-terms default with base-month label; nominal + cash/accrual toggles work and **persist across navigation**.

## Phase 2 Outline (separate plan when Phase 1 ships)

Per spec §10 + review deferrals: **merchant-alias map** (fixes HBO/PedidosYa/PERSONAL splits — rev note 7); MEP fetcher + USD value mode (chart 9); cuota waterfall with 3 projection layers (chart 4, spec §5); anomaly engine — duplicates, amount jumps, never-seen merchants (chart 10); personal-inflation lens vs INDEC IPC (chart 8); Sankey (chart 2); calendar heatmap (chart 3); tax-inclusive "true cost" toggle (spec §3); purchase-date CPI keying refinement if cycle-midpoint proves too coarse.

## Phase 3 Outline (separate plan)

Per spec §10: drag-drop PDF upload → route handler invoking `scripts/pdf_to_json.py`; LLM-assisted categorization flow (merchant string only, writes to `data/merchant-categories.json`, manual override wins — spec §7); alert review UI over the `alerts` table.
