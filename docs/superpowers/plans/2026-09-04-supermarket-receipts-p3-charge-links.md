# Supermarket Receipts P3 — Charge Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link each stored supermarket receipt to the card charge that paid it, automatically when the match is unambiguous and by hand otherwise, and show the supermarket charges that have no receipt.

**Architecture:** Charges get a stable identity (`transactions.fingerprint`, a hash of the statement line, computed at ingest and backfilled once) because their row ids do not survive a re-ingest. One table, `receipt_charge_links`, holds the links; states (matched / pending / unmatched) are derived on read from links and candidates. The matcher runs after a receipt is stored and after a statement is ingested. One page lists both sides; the receipt detail shows its charge; the charges drill table links back to the receipt.

**Tech Stack:** Next.js 16 (RSC, server actions), TypeScript, better-sqlite3, vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`, §9 (P3). **Prerequisite:** P1 merged (`receipts` tables, `storeReceipt` in `web/src/lib/receipts/ingest.ts`, the `/receipts/[id]` page). P2 is not required, but if it is merged, `storeReceipt` already ends with `matchReceipt(db, id)`; the call added here goes after it.

## Global Constraints

- Node 20 via nvm (`web/.nvmrc`). Run `nvm use` before `npm`. All commands run from `web/` unless a path says otherwise.
- Commit on the current branch (`dev`), one commit per task, message ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Identifiers and comments in English. UI copy only in `web/src/lib/i18n.ts`, both dictionaries, same placeholders (`src/lib/i18n.test.ts`).
- Every route directory needs a `CHROME` entry; pages render no `<h1>` (`src/lib/chrome.test.ts`).
- Reconciliation never edits a charge or a receipt: it writes and deletes rows in `receipt_charge_links` only.
- Charges are pesos in `REAL`; receipts are integer cents. Every comparison converts the charge with `Math.round(ars * 100)`.
- A charge paid in installments stands for the whole purchase: `purchaseCents = round(ars × 100) × installment_count`. Only its first installment (`installment_number IS NULL OR = 1`) is a candidate; later installments are the same purchase again.
- The auto matcher links only when exactly one candidate exists. Two candidates are a decision for the user.
- `npm test` stays offline and fast; every test here uses `openDb(":memory:")`.

---

## File structure

Created:

| File | Responsibility |
|---|---|
| `web/src/lib/fingerprint.ts` | `chargeFingerprint`, `fingerprintAll`, `backfillFingerprints` — stable charge identity |
| `web/src/lib/receipts/charges.ts` | Candidates, auto-link, manual link/unlink, the reconciliation reads |
| `web/src/app/super/charges/page.tsx`, `actions.ts` | The reconciliation page and its server actions |

Modified: `web/src/lib/db.ts` (column, index, backfill, links table), `web/src/lib/db.test.ts`, `web/src/lib/ingest.ts` (fingerprint per row, auto-link after ingest), `web/src/lib/ingest.test.ts`, `web/src/lib/receipts/ingest.ts` (auto-link after store), `web/src/lib/queries.ts` (`fingerprint` and `receiptId` on drill rows), `web/src/app/categories/page.tsx` (receipt link), `web/src/app/receipts/[id]/page.tsx` (charge section), `web/src/components/Nav.tsx`, `web/src/lib/chrome.ts`, `web/src/lib/i18n.ts`, `web/README.md`.

Types shared across tasks:

```ts
// fingerprint.ts
type ChargeIdentity = { brand: string; date: string | null; description: string; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null };
// charges.ts
type ChargeRef = { fingerprint: string; brand: string; date: string | null; description: string; merchant: string; ars: number;
  installment_number: number | null; installment_count: number | null; cycle_month: string; statement_file: string; purchaseCents: number };
type LinkMethod = "auto" | "manual";
type ReceiptSide = { id: number; date: string; totalCents: number; state: "matched" | "pending" | "unmatched";
  charge: ChargeRef | null; method: LinkMethod | null; candidates: ChargeRef[] };
type ChargeSide = ChargeRef & { receiptId: number | null; receiptDate: string | null; method: LinkMethod | null };
type Reconciliation = { receipts: ReceiptSide[]; charges: ChargeSide[];
  summary: { chargedCents: number; analyzedCents: number; matchedCents: number; unmatchedCharges: number; pendingReceipts: number; unmatchedReceipts: number } };
type AutoLinkReport = { linked: number; pending: number; unmatched: number };
```

---

### Task 1: A stable identity for every charge

**Files:**
- Create: `web/src/lib/fingerprint.ts`
- Test: `web/src/lib/fingerprint.test.ts`
- Modify: `web/src/lib/ingest.ts` (`statementToRows`, `ingestFile`), `web/src/lib/ingest.test.ts`, `web/src/lib/db.ts` (`migrate()`), `web/src/lib/db.test.ts`

**Interfaces:**
- Produces: `chargeKey(c: ChargeIdentity): string`, `chargeFingerprint(c: ChargeIdentity, ordinal: number): string` (40 hex chars), `fingerprintAll(brand: string, txs: Omit<ChargeIdentity, "brand">[]): string[]`, `backfillFingerprints(db): number`; `transactions.fingerprint TEXT` filled for every row.

Why a hash and not the row id: `ingestFile` deletes and re-inserts a statement's rows on every re-ingest (`src/lib/ingest.ts`, the `DELETE ... RETURNING` at the top of the transaction), so ids change while the printed line does not. Two identical lines on one statement (two coffees) get ordinals 1 and 2 so both stay distinct and deterministic: the JSON keeps the statement's order.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/fingerprint.test.ts
import { describe, it, expect } from "vitest";
import { chargeFingerprint, fingerprintAll, type ChargeIdentity } from "@/lib/fingerprint";

const coto: ChargeIdentity = {
  brand: "visa", date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8, usd: null,
  installment_number: null, installment_count: null,
};

describe("chargeFingerprint", () => {
  it("is deterministic and 40 hex characters", () => {
    expect(chargeFingerprint(coto, 1)).toMatch(/^[0-9a-f]{40}$/);
    expect(chargeFingerprint(coto, 1)).toBe(chargeFingerprint({ ...coto }, 1));
  });
  it("changes with any identifying field and with the ordinal", () => {
    const base = chargeFingerprint(coto, 1);
    expect(chargeFingerprint({ ...coto, ars: 115370.81 }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, date: "2026-08-08" }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, brand: "mastercard" }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, installment_number: 1, installment_count: 2 }, 1)).not.toBe(base);
    expect(chargeFingerprint(coto, 2)).not.toBe(base);
  });
  it("does not depend on merchant or category, which aliases and rules rewrite", () => {
    // Only the seven identity fields exist on the type; this documents the intent.
    expect(Object.keys(coto).sort()).toEqual(["ars", "brand", "date", "description", "installment_count", "installment_number", "usd"]);
  });
});

describe("fingerprintAll", () => {
  it("numbers identical lines in order and leaves distinct lines at ordinal 1", () => {
    const { brand, ...line } = coto;
    const fps = fingerprintAll(brand, [line, { ...line, ars: 1 }, line]);
    expect(fps[0]).toBe(chargeFingerprint(coto, 1));
    expect(fps[1]).toBe(chargeFingerprint({ ...coto, ars: 1 }, 1));
    expect(fps[2]).toBe(chargeFingerprint(coto, 2));
    expect(new Set(fps).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fingerprint.test.ts`
Expected: FAIL — cannot resolve `@/lib/fingerprint`.

- [ ] **Step 3: Write the module**

```ts
// web/src/lib/fingerprint.ts
import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * What identifies one statement line across re-ingests: the card, the printed date, the printed
 * description, the amounts and the installment position. NOT merchant or category — aliases and
 * rules rewrite those, and a link to a charge must survive a recategorisation.
 */
export type ChargeIdentity = {
  brand: string; date: string | null; description: string; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

export function chargeKey(c: ChargeIdentity): string {
  return [c.brand, c.date ?? "", c.description, c.ars ?? "", c.usd ?? "", c.installment_number ?? "", c.installment_count ?? ""].join("|");
}

/** sha1 of the key plus an ordinal: the n-th identical line on a statement is its own charge. */
export function chargeFingerprint(c: ChargeIdentity, ordinal: number): string {
  return crypto.createHash("sha1").update(`${chargeKey(c)}#${ordinal}`).digest("hex");
}

/** Fingerprints for a statement's lines, in statement order. */
export function fingerprintAll(brand: string, txs: Omit<ChargeIdentity, "brand">[]): string[] {
  const seen = new Map<string, number>();
  return txs.map(t => {
    const c = { brand, ...t };
    const n = (seen.get(chargeKey(c)) ?? 0) + 1;
    seen.set(chargeKey(c), n);
    return chargeFingerprint(c, n);
  });
}

/**
 * Rows ingested before the column existed. Statement by statement, in insertion order (the
 * order of the JSON, which is the order of the statement), so ordinals come out as a fresh
 * ingest would compute them. Idempotent: only NULL rows are touched.
 */
export function backfillFingerprints(db: Database.Database): number {
  const statements = db.prepare(`
    SELECT DISTINCT s.id, s.brand FROM statements s JOIN transactions t ON t.statement_id = s.id
    WHERE t.fingerprint IS NULL`).all() as { id: number; brand: string }[];
  const rows = db.prepare(`
    SELECT id, date, description, ars, usd, installment_number, installment_count
    FROM transactions WHERE statement_id = ? ORDER BY id`);
  const update = db.prepare("UPDATE transactions SET fingerprint = ? WHERE id = ? AND fingerprint IS NULL");
  let changed = 0;
  db.transaction(() => {
    for (const s of statements) {
      const txs = rows.all(s.id) as ({ id: number } & Omit<ChargeIdentity, "brand">)[];
      fingerprintAll(s.brand, txs).forEach((fp, i) => { changed += update.run(fp, txs[i].id).changes; });
    }
  })();
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fingerprint.test.ts` — PASS (4 tests).

- [ ] **Step 5: Write the failing ingest and migration tests**

Append to `describe("statementToRows", ...)` in `web/src/lib/ingest.test.ts`:

```ts
  it("gives every transaction a fingerprint, stable across two runs", () => {
    const a = statementToRows(fixture, rules, aliases).transactions.map(t => t.fingerprint);
    const b = statementToRows(fixture, rules, aliases).transactions.map(t => t.fingerprint);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const fp of a) expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });
```

Append to `describe("ingestFile", ...)`:

```ts
  it("keeps the same fingerprints when a statement is ingested again", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules, aliases);
    const before = db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all();
    ingestFile(db, fixture, rules, aliases);
    const after = db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all();
    expect(after).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE fingerprint IS NULL").get()).toEqual({ n: 0 });
  });
```

Append to `describe("db", ...)` in `web/src/lib/db.test.ts`:

```ts
  it("adds fingerprint to an older transactions table and backfills it, numbering identical lines", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE statements (id INTEGER PRIMARY KEY, file TEXT UNIQUE NOT NULL, brand TEXT NOT NULL,
        closing_date TEXT NOT NULL, cycle_month TEXT NOT NULL, due_date TEXT, prev_closing_date TEXT,
        balance_ars REAL, balance_usd REAL, minimum_payment_ars REAL);
      CREATE TABLE transactions (id INTEGER PRIMARY KEY, statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
        section TEXT NOT NULL, date TEXT, description TEXT NOT NULL, merchant TEXT NOT NULL, category TEXT NOT NULL,
        subcategory TEXT, ars REAL, usd REAL, installment_number INTEGER, installment_count INTEGER);
      INSERT INTO statements (file, brand, closing_date, cycle_month) VALUES ('v.pdf', 'visa', '2026-08-29', '2026-08');
      INSERT INTO transactions (statement_id, section, date, description, merchant, category, ars) VALUES
        (1, 'purchases', '2026-08-07', 'MERPAGO*COTO', 'COTO', 'food', 115370.8),
        (1, 'purchases', '2026-08-07', 'MERPAGO*COTO', 'COTO', 'food', 115370.8),
        (1, 'purchases', '2026-08-09', 'CAFE', 'CAFE', 'food', 2500);
    `);
    migrate(db);
    const fps = (db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all() as { fingerprint: string }[]).map(r => r.fingerprint);
    expect(fps.every(f => /^[0-9a-f]{40}$/.test(f))).toBe(true);
    expect(new Set(fps).size).toBe(3);
    migrate(db); // idempotent: no re-ALTER, no rewrite
    expect((db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all() as { fingerprint: string }[]).map(r => r.fingerprint)).toEqual(fps);
  });
```

Run: `npx vitest run src/lib/ingest.test.ts src/lib/db.test.ts` — the three new tests FAIL (`fingerprint` undefined / `no such column`).

- [ ] **Step 6: Compute it at ingest and widen the table**

In `web/src/lib/ingest.ts`, import `fingerprintAll` and change `statementToRows`:

```ts
import { fingerprintAll } from "@/lib/fingerprint";
// ...
  const fingerprints = fingerprintAll(json.brand, json.transactions);
  const transactions = json.transactions.map((t, i) => {
    const { merchant, category, subcategory } = deriveTransaction(t.description, t.section, rules, aliases);
    return {
      section: t.section,
      date: t.date,
      description: t.description,
      merchant,
      category, subcategory,
      ars: t.ars, usd: t.usd,
      installment_number: t.installment_number,
      installment_count: t.installment_count,
      // Stable across re-ingest; rows are deleted and re-inserted, ids are not (see receipt links).
      fingerprint: fingerprints[i],
    };
  });
```

and the insert in `ingestFile`:

```ts
    const insTx = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count, fingerprint)
       VALUES (?, @section, @date, @description, @merchant, @category, @subcategory, @ars, @usd, @installment_number, @installment_count, @fingerprint)`
    );
```

In `web/src/lib/db.ts`: add `fingerprint TEXT` to the `CREATE TABLE IF NOT EXISTS transactions` column list (after `installment_count INTEGER`), add `CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(fingerprint);` after `idx_tx_statement`, and after the existing statements-widening loop:

```ts
  // Same widening for transactions.fingerprint (charge identity for receipt links), then a
  // one-time backfill so rows from before the column can be linked too.
  const txCols = new Set(
    (db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map(c => c.name)
  );
  if (!txCols.has("fingerprint")) {
    db.exec("ALTER TABLE transactions ADD COLUMN fingerprint TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(fingerprint)");
  }
  backfillFingerprints(db);
```

with `import { backfillFingerprints } from "@/lib/fingerprint";` at the top. The `CREATE INDEX` in the main `exec` block runs before the `ALTER` on an old database and would fail on a missing column, so move that index statement out of the block and keep only the guarded one above — i.e. do **not** add it to the `db.exec` string; add it only in the `if`, plus one unguarded `db.exec("CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(fingerprint)")` right after the `if` so fresh databases get it too.

- [ ] **Step 7: Run the tests, commit**

Run: `npx vitest run src/lib/fingerprint.test.ts src/lib/ingest.test.ts src/lib/db.test.ts` — PASS. Then `npx vitest run` — everything else still green (`queries.test.ts` inserts transactions without a fingerprint; the column is nullable, so that is fine).

```bash
git add src/lib/fingerprint.ts src/lib/fingerprint.test.ts src/lib/ingest.ts src/lib/ingest.test.ts src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(charges): stable fingerprint per statement line, computed at ingest and backfilled"
```

---

### Task 2: Links, candidates, the auto matcher

**Files:**
- Modify: `web/src/lib/db.ts` (links table)
- Create: `web/src/lib/receipts/charges.ts`
- Test: `web/src/lib/receipts/charges.test.ts`
- Modify: `web/src/lib/receipts/ingest.ts` (call after store), `web/src/lib/ingest.ts` (call after statement ingest)

**Interfaces:**
- Consumes: `transactions.fingerprint` (Task 1); receipts tables (P1); `storeReceipt` (P1); `ingestFile`.
- Produces: `MATCH_WINDOW_DAYS = 3`; `amountMatches(ars: number, installmentCount: number | null, totalCents: number): boolean`; `candidateCharges(db, receipt: { id: number; date: string; totalCents: number }): ChargeRef[]`; `autoLink(db): AutoLinkReport`; `linkReceipt(db, receiptId, fingerprint, method?: LinkMethod): void`; `unlinkReceipt(db, receiptId): void`.

- [ ] **Step 1: Add the table**

Inside `migrate()`'s `db.exec` string, after the last receipts table (or after the product tables if P2 is in):

```sql
    -- One receipt ↔ one charge. The charge side is a fingerprint, not transactions.id: rows are
    -- rebuilt on every re-ingest and their ids change, the fingerprint does not (see
    -- fingerprint.ts). No foreign key for the same reason alert_reviews has none.
    CREATE TABLE IF NOT EXISTS receipt_charge_links (
      receipt_id INTEGER NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL CHECK (method IN ('auto','manual')),
      created_at TEXT NOT NULL
    );
```

- [ ] **Step 2: Write the failing test**

The two real cases from the live database anchor this: the 2026-08-07 receipt (115370.80) is a `visa` charge `MERPAGO*COTO` of 115370.8 on the same date; the 2026-08-14 receipt (84288.50) is a `mercadopago` charge of 42144.25, installment 1 of 2.

```ts
// web/src/lib/receipts/charges.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFile } from "@/lib/ingest";
import type { StatementJson } from "@/lib/integrity";
import type { Rule } from "@/lib/categorize";
import {
  MATCH_WINDOW_DAYS, amountMatches, candidateCharges, autoLink, linkReceipt, unlinkReceipt,
} from "@/lib/receipts/charges";

type Db = ReturnType<typeof openDb>;
const RULES: Rule[] = [{ match: "COTO", category: "food", subcategory: "supermarket" }, { match: "CAFE", category: "food", subcategory: "restaurant" }];

type Line = { date: string; description: string; ars: number; n?: number | null; of?: number | null };
function statement(brand: string, file: string, closing: string, lines: Line[]): StatementJson {
  return {
    file, brand,
    period: { closing_date: closing, due_date: closing, previous_closing_date: null },
    transactions: lines.map(l => ({
      section: "purchases", block: 1, date: l.date, description: l.description, ars: l.ars, usd: null,
      installment_number: l.n ?? null, installment_count: l.of ?? null,
    })),
  };
}
function receipt(db: Db, date: string, totalCents: number, fiscal = `2090-${date}${totalCents}`): number {
  return Number(db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', ?, ?, ?, '/x', ?, 0, ?, '{}', '{}', 'ocr', 3, 'now')`).run(date, fiscal, `sha-${fiscal}`, totalCents, totalCents).lastInsertRowid);
}
const links = (db: Db) => db.prepare("SELECT receipt_id, method FROM receipt_charge_links ORDER BY receipt_id").all();
const fpOf = (db: Db, description: string, ars: number) =>
  (db.prepare("SELECT fingerprint FROM transactions WHERE description = ? AND ars = ?").get(description, ars) as { fingerprint: string }).fingerprint;

describe("amountMatches", () => {
  it("accepts the exact total, or the installment times its count within a cent per installment", () => {
    expect(amountMatches(115370.8, null, 11537080)).toBe(true);
    expect(amountMatches(42144.25, 2, 8428850)).toBe(true);
    expect(amountMatches(42353.88, 3, 12706163)).toBe(true);   // 127061.63 / 3 rounded per installment
    expect(amountMatches(115370.81, null, 11537080)).toBe(false);
    expect(amountMatches(42144.25, null, 8428850)).toBe(false); // not an installment: half is not the total
    expect(amountMatches(42000, 3, 12706163)).toBe(false);
  });
});

describe("candidateCharges and autoLink", () => {
  it("links a same-day charge for the exact amount (the 2026-08-07 case)", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "visa_2026_08_29.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 },
      { date: "2026-08-09", description: "CAFE MARTINEZ", ars: 115370.8 }, // same amount, not a supermarket
    ]), RULES, []);
    const id = receipt(db, "2026-08-07", 11537080);
    expect(candidateCharges(db, { id, date: "2026-08-07", totalCents: 11537080 }).map(c => c.description)).toEqual(["MERPAGO*COTO"]);
    expect(autoLink(db)).toEqual({ linked: 1, pending: 0, unmatched: 0 });
    expect(links(db)).toEqual([{ receipt_id: id, method: "auto" }]);
  });

  it("links a charge paid in installments through its first installment only (the 2026-08-14 case)", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("mercadopago", "mp_2026_08_18.pdf", "2026-08-18", [
      { date: "2026-08-14", description: "MERPAGO*COTO", ars: 42144.25, n: 1, of: 2 },
    ]), RULES, []);
    ingestFile(db, statement("mercadopago", "mp_2026_09_18.pdf", "2026-09-18", [
      { date: "2026-08-14", description: "MERPAGO*COTO", ars: 42144.25, n: 2, of: 2 },
    ]), RULES, []);
    const id = receipt(db, "2026-08-14", 8428850);
    const c = candidateCharges(db, { id, date: "2026-08-14", totalCents: 8428850 });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ installment_number: 1, installment_count: 2, purchaseCents: 8428850, cycle_month: "2026-08" });
    expect(autoLink(db).linked).toBe(1);
  });

  it("uses a ±3 day window and leaves two candidates to the user", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-10", description: "MERPAGO*COTO", ars: 5000 },
      { date: "2026-08-04", description: "MERPAGO*COTO", ars: 5000 },   // 3 days before: in
      { date: "2026-08-11", description: "MERPAGO*COTO", ars: 7000 },   // 4 days after: out
    ]), RULES, []);
    const ambiguous = receipt(db, "2026-08-07", 500000);
    const late = receipt(db, "2026-08-07", 700000, "2090-late");
    expect(MATCH_WINDOW_DAYS).toBe(3);
    expect(candidateCharges(db, { id: ambiguous, date: "2026-08-07", totalCents: 500000 })).toHaveLength(2);
    expect(candidateCharges(db, { id: late, date: "2026-08-07", totalCents: 700000 })).toHaveLength(0);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 1, unmatched: 1 });
    expect(links(db)).toEqual([]);
  });

  it("never offers a charge that is already linked to another receipt", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 5000 }]), RULES, []);
    const first = receipt(db, "2026-08-07", 500000, "a");
    const second = receipt(db, "2026-08-08", 500000, "b");
    autoLink(db); // first gets it? No: both receipts see one candidate → ambiguity is per charge too.
    expect(links(db)).toEqual([]);
    linkReceipt(db, first, fpOf(db, "MERPAGO*COTO", 5000));
    expect(candidateCharges(db, { id: second, date: "2026-08-08", totalCents: 500000 })).toEqual([]);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 0, unmatched: 1 });
  });

  it("does not link a receipt twice, and survives a re-ingest of the statement", () => {
    const db = openDb(":memory:");
    const s = statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 }]);
    ingestFile(db, s, RULES, []);
    receipt(db, "2026-08-07", 11537080);
    autoLink(db);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 0, unmatched: 0 });
    ingestFile(db, s, RULES, []); // rows deleted and re-inserted; the fingerprint is the same
    const fp = (db.prepare("SELECT fingerprint FROM receipt_charge_links").get() as { fingerprint: string }).fingerprint;
    expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE fingerprint = ?").get(fp)).toEqual({ n: 1 });
  });
});

describe("linkReceipt / unlinkReceipt", () => {
  it("links by hand, replaces a previous link of the same receipt, and refuses a taken charge", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 5000 },
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 6000 },
    ]), RULES, []);
    const a = receipt(db, "2026-08-07", 500000, "a");
    const b = receipt(db, "2026-08-07", 600000, "b");
    const fp5 = fpOf(db, "MERPAGO*COTO", 5000), fp6 = fpOf(db, "MERPAGO*COTO", 6000);
    linkReceipt(db, a, fp6);            // the user knows better than the amount
    expect(links(db)).toEqual([{ receipt_id: a, method: "manual" }]);
    linkReceipt(db, a, fp5);            // re-link: the old link goes
    expect(db.prepare("SELECT fingerprint FROM receipt_charge_links WHERE receipt_id = ?").get(a)).toEqual({ fingerprint: fp5 });
    expect(() => linkReceipt(db, b, fp5)).toThrow(/already linked/);
    expect(() => linkReceipt(db, b, "0".repeat(40))).toThrow(/no charge/);
    expect(() => linkReceipt(db, 999, fp6)).toThrow(/no receipt/);
    unlinkReceipt(db, a);
    expect(links(db)).toEqual([]);
    unlinkReceipt(db, a); // no-op
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/charges.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/charges`.

- [ ] **Step 4: Write the module**

```ts
// web/src/lib/receipts/charges.ts
import type Database from "better-sqlite3";

export type LinkMethod = "auto" | "manual";
export type ChargeRef = {
  fingerprint: string; brand: string; date: string | null; description: string; merchant: string; ars: number;
  installment_number: number | null; installment_count: number | null; cycle_month: string; statement_file: string;
  /** The whole purchase: one installment times the count. What a receipt total compares against. */
  purchaseCents: number;
};
export type AutoLinkReport = { linked: number; pending: number; unmatched: number };

/** Card charges post late; three days covers every case seen and keeps a weekly shop from matching the next one. */
export const MATCH_WINDOW_DAYS = 3;

/** Exact total, or one installment times its count — within a cent per installment, the bank rounds each. */
export function amountMatches(ars: number, installmentCount: number | null, totalCents: number): boolean {
  const cents = Math.round(ars * 100);
  if (installmentCount === null || installmentCount <= 1) return cents === totalCents;
  return Math.abs(cents * installmentCount - totalCents) <= installmentCount;
}

// A supermarket purchase, first installment only, not yet linked. The date window is SQL; the
// amount test is JS because it depends on the installment count.
const CANDIDATE_SQL = `
  SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
         s.cycle_month, s.file AS statement_file
  FROM transactions t JOIN statements s ON s.id = t.statement_id
  WHERE t.section = 'purchases' AND t.category = 'food' AND t.subcategory = 'supermarket'
    AND t.ars IS NOT NULL AND t.ars > 0 AND t.date IS NOT NULL AND t.fingerprint IS NOT NULL
    AND (t.installment_number IS NULL OR t.installment_number = 1)
    AND t.date BETWEEN date(?, ?) AND date(?, ?)
    AND t.fingerprint NOT IN (SELECT fingerprint FROM receipt_charge_links)
  ORDER BY t.date, t.id`;

type ChargeRow = Omit<ChargeRef, "purchaseCents">;
const withPurchase = (r: ChargeRow): ChargeRef => ({
  ...r, purchaseCents: Math.round(r.ars * 100) * (r.installment_count && r.installment_count > 1 ? r.installment_count : 1),
});

export function candidateCharges(
  db: Database.Database, receipt: { id: number; date: string; totalCents: number },
): ChargeRef[] {
  const rows = db.prepare(CANDIDATE_SQL)
    .all(receipt.date, `-${MATCH_WINDOW_DAYS} days`, receipt.date, `+${MATCH_WINDOW_DAYS} days`) as ChargeRow[];
  return rows.filter(r => amountMatches(r.ars, r.installment_count, receipt.totalCents)).map(withPurchase);
}

/**
 * Every receipt without a link: exactly one candidate → linked (auto); several → left for the
 * user (pending); none → unmatched. A charge that is the single candidate of two receipts is
 * linked to neither: ambiguity on either side is the user's call. Runs after a receipt is
 * stored and after a statement is ingested; cheap, because linked receipts are skipped.
 */
export function autoLink(db: Database.Database): AutoLinkReport {
  const open = db.prepare(`
    SELECT r.id, r.date, r.total_cents AS totalCents FROM receipts r
    WHERE r.id NOT IN (SELECT receipt_id FROM receipt_charge_links) ORDER BY r.date, r.id`)
    .all() as { id: number; date: string; totalCents: number }[];
  const report: AutoLinkReport = { linked: 0, pending: 0, unmatched: 0 };
  const proposals = new Map<string, number[]>(); // fingerprint → receipts it is the single candidate of
  const single: { id: number; fingerprint: string }[] = [];
  for (const r of open) {
    const c = candidateCharges(db, r);
    if (c.length === 0) report.unmatched++;
    else if (c.length > 1) report.pending++;
    else { single.push({ id: r.id, fingerprint: c[0].fingerprint }); proposals.set(c[0].fingerprint, [...(proposals.get(c[0].fingerprint) ?? []), r.id]); }
  }
  db.transaction(() => {
    for (const s of single) {
      if ((proposals.get(s.fingerprint) ?? []).length > 1) { report.pending++; continue; }
      insertLink(db, s.id, s.fingerprint, "auto");
      report.linked++;
    }
  })();
  return report;
}

function insertLink(db: Database.Database, receiptId: number, fingerprint: string, method: LinkMethod): void {
  db.prepare("INSERT INTO receipt_charge_links (receipt_id, fingerprint, method, created_at) VALUES (?, ?, ?, ?)")
    .run(receiptId, fingerprint, method, new Date().toISOString());
}

/** The user's decision. Replaces this receipt's previous link; refuses a charge another receipt holds. */
export function linkReceipt(db: Database.Database, receiptId: number, fingerprint: string, method: LinkMethod = "manual"): void {
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM receipts WHERE id = ?").get(receiptId)) throw new Error(`no receipt ${receiptId}`);
    if (!db.prepare("SELECT 1 FROM transactions WHERE fingerprint = ?").get(fingerprint)) throw new Error(`no charge ${fingerprint}`);
    const holder = db.prepare("SELECT receipt_id FROM receipt_charge_links WHERE fingerprint = ?").get(fingerprint) as { receipt_id: number } | undefined;
    if (holder && holder.receipt_id !== receiptId) throw new Error(`charge already linked to receipt ${holder.receipt_id}`);
    db.prepare("DELETE FROM receipt_charge_links WHERE receipt_id = ?").run(receiptId);
    insertLink(db, receiptId, fingerprint, method);
  })();
}

export function unlinkReceipt(db: Database.Database, receiptId: number): void {
  db.prepare("DELETE FROM receipt_charge_links WHERE receipt_id = ?").run(receiptId);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/charges.test.ts src/lib/db.test.ts`
Expected: PASS (7 tests + db). If the "±3 day window" test finds the 2026-08-04 charge missing, check the SQL modifier strings: SQLite wants `date('2026-08-07', '-3 days')`, with the space.

- [ ] **Step 6: Hook it into both ingests**

In `web/src/lib/receipts/ingest.ts`, `storeReceipt`, after `matchReceipt(db, id);` (or after the `insert()` try/catch if P2 is not in), add:

```ts
  // The charge that paid this receipt may already be in the database.
  autoLink(db);
```

with `import { autoLink } from "./charges";`.

In `web/src/lib/ingest.ts`, `ingestFile`, after `run();` and before the `return`:

```ts
  // A new statement may carry the charge for a receipt uploaded earlier.
  autoLink(db);
```

with `import { autoLink } from "@/lib/receipts/charges";`.

Add to `web/src/lib/receipts/charges.test.ts`:

```ts
describe("hooks", () => {
  it("links a receipt when the statement that pays it arrives later", () => {
    const db = openDb(":memory:");
    receipt(db, "2026-08-07", 11537080);
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 }]), RULES, []);
    expect(links(db)).toEqual([{ receipt_id: 1, method: "auto" }]);
  });
});
```

Run: `npx vitest run` — all green (the P1 ingest tests store receipts into databases with no statements: `autoLink` reports unmatched and writes nothing).

- [ ] **Step 7: Commit**

```bash
git add src/lib/db.ts src/lib/receipts/charges.ts src/lib/receipts/charges.test.ts src/lib/receipts/ingest.ts src/lib/ingest.ts
git commit -m "feat(charges): link receipts to the charges that paid them — auto when unambiguous"
```

---

### Task 3: The reconciliation reads

**Files:**
- Modify: `web/src/lib/receipts/charges.ts` (add the reads)
- Test: `web/src/lib/receipts/charges.test.ts` (append)

**Interfaces:**
- Produces: `receiptSide(db, receiptId): ReceiptSide | null`, `reconciliation(db): Reconciliation`, types `ReceiptSide`, `ChargeSide`, `Reconciliation` as in the table at the top.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/receipts/charges.test.ts` (extend the import line with `receiptSide, reconciliation`):

```ts
describe("reconciliation reads", () => {
  function world() {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 },          // matched
      { date: "2026-08-21", description: "COTO SUCURSAL 90", ars: 6666.5, n: 1, of: 3 }, // no receipt → unmatched charge
      { date: "2026-08-10", description: "MERPAGO*COTO", ars: 5000 },              // two candidates for one receipt
      { date: "2026-08-09", description: "MERPAGO*COTO", ars: 5000 },
    ]), RULES, []);
    receipt(db, "2026-08-07", 11537080, "m");
    receipt(db, "2026-08-08", 500000, "p");   // pending: two candidates
    receipt(db, "2026-08-28", 12188854, "u"); // unmatched: no charge yet
    autoLink(db);
    return db;
  }

  it("describes one receipt: its charge, or its candidates", () => {
    const db = world();
    expect(receiptSide(db, 1)).toMatchObject({
      id: 1, date: "2026-08-07", totalCents: 11537080, state: "matched", method: "auto",
      charge: { description: "MERPAGO*COTO", ars: 115370.8, brand: "visa", purchaseCents: 11537080, cycle_month: "2026-08" },
      candidates: [],
    });
    const pending = receiptSide(db, 2)!;
    expect(pending.state).toBe("pending");
    expect(pending.charge).toBeNull();
    expect(pending.candidates.map(c => c.date)).toEqual(["2026-08-09", "2026-08-10"]);
    expect(receiptSide(db, 3)).toMatchObject({ state: "unmatched", charge: null, candidates: [] });
    expect(receiptSide(db, 99)).toBeNull();
  });

  it("lists both sides with a summary", () => {
    const r = reconciliation(world());
    expect(r.receipts.map(x => x.state)).toEqual(["unmatched", "pending", "matched"]); // newest first
    expect(r.charges.map(c => [c.date, c.receiptId])).toEqual([
      ["2026-08-21", null], ["2026-08-10", null], ["2026-08-09", null], ["2026-08-07", 1],
    ]);
    expect(r.charges[0].purchaseCents).toBe(1999950); // 6666.5 × 3
    expect(r.summary).toEqual({
      chargedCents: 11537080 + 1999950 + 500000 + 500000,
      analyzedCents: 11537080 + 500000 + 12188854,
      matchedCents: 11537080,
      unmatchedCharges: 3, pendingReceipts: 1, unmatchedReceipts: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/charges.test.ts` — FAIL: `receiptSide` is not exported.

- [ ] **Step 3: Add the reads**

Append to `web/src/lib/receipts/charges.ts`:

```ts
export type ReceiptSide = {
  id: number; date: string; totalCents: number;
  state: "matched" | "pending" | "unmatched";
  charge: ChargeRef | null; method: LinkMethod | null; candidates: ChargeRef[];
};
export type ChargeSide = ChargeRef & { receiptId: number | null; receiptDate: string | null; method: LinkMethod | null };
export type Reconciliation = {
  receipts: ReceiptSide[];
  charges: ChargeSide[];
  summary: {
    chargedCents: number; analyzedCents: number; matchedCents: number;
    unmatchedCharges: number; pendingReceipts: number; unmatchedReceipts: number;
  };
};

const LINKED_CHARGE_SQL = `
  SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
         s.cycle_month, s.file AS statement_file, l.method
  FROM receipt_charge_links l
  JOIN transactions t ON t.fingerprint = l.fingerprint
  JOIN statements s ON s.id = t.statement_id
  WHERE l.receipt_id = ?
  ORDER BY t.installment_number LIMIT 1`;

/** One receipt's side of the ledger: the charge it is linked to, or what it could be linked to. */
export function receiptSide(db: Database.Database, receiptId: number): ReceiptSide | null {
  const r = db.prepare("SELECT id, date, total_cents AS totalCents FROM receipts WHERE id = ?").get(receiptId) as
    { id: number; date: string; totalCents: number } | undefined;
  if (!r) return null;
  const linked = db.prepare(LINKED_CHARGE_SQL).get(receiptId) as (ChargeRow & { method: LinkMethod }) | undefined;
  if (linked) {
    const { method, ...charge } = linked;
    return { ...r, state: "matched", charge: withPurchase(charge), method, candidates: [] };
  }
  const candidates = candidateCharges(db, r);
  return { ...r, state: candidates.length > 1 ? "pending" : "unmatched", charge: null, method: null, candidates };
}

/**
 * Both sides, newest first. The charge side is every supermarket purchase (first installments
 * only), linked or not: the unlinked ones are shopping trips with no receipt uploaded — the
 * completeness check receipts alone cannot give.
 */
export function reconciliation(db: Database.Database): Reconciliation {
  const receiptIds = (db.prepare("SELECT id FROM receipts ORDER BY date DESC, time DESC, id DESC").all() as { id: number }[]).map(x => x.id);
  const receipts = receiptIds.map(id => receiptSide(db, id)!);
  const chargeRows = db.prepare(`
    SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
           s.cycle_month, s.file AS statement_file, l.receipt_id AS receiptId, r.date AS receiptDate, l.method
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    LEFT JOIN receipt_charge_links l ON l.fingerprint = t.fingerprint
    LEFT JOIN receipts r ON r.id = l.receipt_id
    WHERE t.section = 'purchases' AND t.category = 'food' AND t.subcategory = 'supermarket'
      AND t.ars IS NOT NULL AND t.ars > 0 AND t.fingerprint IS NOT NULL
      AND (t.installment_number IS NULL OR t.installment_number = 1)
    ORDER BY t.date DESC, t.id DESC`).all() as (ChargeRow & { receiptId: number | null; receiptDate: string | null; method: LinkMethod | null })[];
  const charges: ChargeSide[] = chargeRows.map(c => ({ ...withPurchase(c), receiptId: c.receiptId, receiptDate: c.receiptDate, method: c.method }));
  return {
    receipts, charges,
    summary: {
      chargedCents: charges.reduce((s, c) => s + c.purchaseCents, 0),
      analyzedCents: receipts.reduce((s, r) => s + r.totalCents, 0),
      matchedCents: charges.filter(c => c.receiptId !== null).reduce((s, c) => s + c.purchaseCents, 0),
      unmatchedCharges: charges.filter(c => c.receiptId === null).length,
      pendingReceipts: receipts.filter(r => r.state === "pending").length,
      unmatchedReceipts: receipts.filter(r => r.state === "unmatched").length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes, commit**

Run: `npx vitest run src/lib/receipts/charges.test.ts` — PASS (10 tests).

```bash
git add src/lib/receipts/charges.ts src/lib/receipts/charges.test.ts
git commit -m "feat(charges): reconciliation reads — each receipt's charge, every charge's receipt"
```

---

### Task 4: The reconciliation page

**Files:**
- Create: `web/src/app/super/charges/page.tsx`, `web/src/app/super/charges/actions.ts`
- Modify: `web/src/components/Nav.tsx`, `web/src/lib/chrome.ts`, `web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `reconciliation`, `linkReceipt`, `unlinkReceipt` (Tasks 2–3); `fmtArsCents` (P1 `money.ts`); `fmtArs` (`format.ts`); `Stat`.
- Produces: route `/super/charges`; server actions `linkChargeAction(formData)` (fields `receipt`, `fingerprint`) and `unlinkChargeAction(formData)` (field `receipt`); nav entry "Charges" in the Supermarket group.

- [ ] **Step 1: Dictionary keys**

`en`:

```ts
  "nav.superCharges": "Charges",
  "super.charges.title": "Supermarket charges and receipts",
  "super.charges.stat.charged": "Charged by supermarkets",
  "super.charges.stat.chargedDetail": "{count} charges on the cards",
  "super.charges.stat.analyzed": "Covered by receipts",
  "super.charges.stat.analyzedDetail": "{pct} of what was charged",
  "super.charges.stat.open": "Without a receipt",
  "super.charges.stat.openDetail": "{count} charges · {pending} receipts to decide",
  "super.charges.receipts": "Receipts",
  "super.charges.charges": "Supermarket charges",
  "super.charges.table.date": "Date",
  "super.charges.table.total": "Total",
  "super.charges.table.state": "State",
  "super.charges.table.charge": "Charge",
  "super.charges.table.card": "Card",
  "super.charges.table.description": "Description",
  "super.charges.table.amount": "Amount",
  "super.charges.table.installments": "Installments",
  "super.charges.table.receipt": "Receipt",
  "super.charges.state.matched": "matched",
  "super.charges.state.pending": "choose one",
  "super.charges.state.unmatched": "no charge yet",
  "super.charges.method.auto": "automatic",
  "super.charges.method.manual": "by hand",
  "super.charges.link": "Link",
  "super.charges.unlink": "Unlink",
  "super.charges.linkTo": "Link to a receipt",
  "super.charges.noReceipt": "no receipt",
  "super.charges.installmentOf": "{n} of {of} · {each} each",
  "super.charges.empty": "No supermarket charges and no receipts yet.",
  "super.charges.footer": "This page puts the two records side by side: the receipts you uploaded and the supermarket charges on your card statements. A receipt is matched when exactly one charge has its amount (or its amount split in installments) within three days of its date; when two charges fit, the page asks you to choose; when none does, the charge has not reached a statement yet. The charges without a receipt are shopping trips this dataset does not see: upload their receipts to close the gap. Linking never changes a charge or a receipt; it only records which paid for which.",
```

`es`:

```ts
  "nav.superCharges": "Cargos",
  "super.charges.title": "Cargos del súper y tickets",
  "super.charges.stat.charged": "Cobrado por supermercados",
  "super.charges.stat.chargedDetail": "{count} cargos en las tarjetas",
  "super.charges.stat.analyzed": "Cubierto por tickets",
  "super.charges.stat.analyzedDetail": "{pct} de lo cobrado",
  "super.charges.stat.open": "Sin ticket",
  "super.charges.stat.openDetail": "{count} cargos · {pending} tickets por decidir",
  "super.charges.receipts": "Tickets",
  "super.charges.charges": "Cargos del súper",
  "super.charges.table.date": "Fecha",
  "super.charges.table.total": "Total",
  "super.charges.table.state": "Estado",
  "super.charges.table.charge": "Cargo",
  "super.charges.table.card": "Tarjeta",
  "super.charges.table.description": "Descripción",
  "super.charges.table.amount": "Importe",
  "super.charges.table.installments": "Cuotas",
  "super.charges.table.receipt": "Ticket",
  "super.charges.state.matched": "vinculado",
  "super.charges.state.pending": "elegí uno",
  "super.charges.state.unmatched": "sin cargo todavía",
  "super.charges.method.auto": "automático",
  "super.charges.method.manual": "a mano",
  "super.charges.link": "Vincular",
  "super.charges.unlink": "Desvincular",
  "super.charges.linkTo": "Vincular a un ticket",
  "super.charges.noReceipt": "sin ticket",
  "super.charges.installmentOf": "{n} de {of} · {each} cada una",
  "super.charges.empty": "Todavía no hay cargos del súper ni tickets.",
  "super.charges.footer": "Esta página pone los dos registros lado a lado: los tickets que cargaste y los cargos de supermercado en los resúmenes de tus tarjetas. Un ticket queda vinculado cuando exactamente un cargo tiene su importe (o su importe dividido en cuotas) a menos de tres días de su fecha; cuando dos cargos encajan, la página te pide elegir; cuando ninguno encaja, el cargo todavía no llegó a un resumen. Los cargos sin ticket son compras que este conjunto de datos no ve: cargá sus tickets para cerrar la brecha. Vincular nunca cambia un cargo ni un ticket; solo registra cuál pagó cuál.",
```

- [ ] **Step 2: Nav and chrome**

`web/src/components/Nav.tsx`, supermarket group: add `["/super/charges", "nav.superCharges"]` after the receipts entry (after `"/receipts"`; before `/super/review` if P2 is in).

`web/src/lib/chrome.ts`: add `"/super/charges": { title: "super.charges.title" },` with the other `/super` entries (or after `/sankey` if P2 is not in).

- [ ] **Step 3: Server actions**

```ts
// web/src/app/super/charges/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { linkReceipt, unlinkReceipt } from "@/lib/receipts/charges";

// Links are shown on this page, on the receipt detail and in the categories drill table, so the
// whole tree is revalidated. Bad input is ignored: the page re-renders unchanged.
export async function linkChargeAction(formData: FormData): Promise<void> {
  const receipt = Number(formData.get("receipt"));
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!Number.isInteger(receipt) || !/^[0-9a-f]{40}$/.test(fingerprint)) return;
  linkReceipt(getDb(), receipt, fingerprint, "manual");
  revalidatePath("/", "layout");
}

export async function unlinkChargeAction(formData: FormData): Promise<void> {
  const receipt = Number(formData.get("receipt"));
  if (!Number.isInteger(receipt)) return;
  unlinkReceipt(getDb(), receipt);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 4: The page**

```tsx
// web/src/app/super/charges/page.tsx
import Link from "next/link";
import { getDb } from "@/lib/db";
import { reconciliation, type ChargeRef } from "@/lib/receipts/charges";
import { fmtArsCents } from "@/lib/receipts/money";
import { fmtArs } from "@/lib/format";
import { Stat } from "@/components/Stat";
import { getT } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";
import { linkChargeAction, unlinkChargeAction } from "./actions";

export const dynamic = "force-dynamic";

const button = "rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90";
const quiet = "rounded-lg px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";

function ChargeLine({ c, tr }: { c: ChargeRef; tr: Translator }) {
  return (
    <span>
      {c.brand} · {c.date} · {c.description} · <span className="font-mono">{fmtArsCents(c.purchaseCents)}</span>
      {c.installment_count && c.installment_count > 1 && (
        <span className="text-ink-muted"> ({tr("super.charges.installmentOf", { n: c.installment_number ?? 1, of: c.installment_count, each: fmtArs(c.ars) })})</span>
      )}
    </span>
  );
}

export default async function SuperCharges() {
  const tr = await getT();
  const r = reconciliation(getDb());
  if (r.receipts.length === 0 && r.charges.length === 0)
    return <main><p className="text-sm text-ink-muted">{tr("super.charges.empty")}</p></main>;
  const s = r.summary;
  const coverage = s.chargedCents === 0 ? 0 : s.matchedCents * 100 / s.chargedCents;
  const unlinkedReceipts = r.receipts.filter(x => x.state !== "matched");
  const th = "py-1 text-left text-ink-muted";
  return (
    <main className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={tr("super.charges.stat.charged")} value={fmtArsCents(s.chargedCents)} detail={tr("super.charges.stat.chargedDetail", { count: r.charges.length })} />
        <Stat label={tr("super.charges.stat.analyzed")} value={fmtArsCents(s.matchedCents)} detail={tr("super.charges.stat.analyzedDetail", { pct: `${coverage.toFixed(0)}%` })} />
        <Stat label={tr("super.charges.stat.open")} value={s.unmatchedCharges} tone={s.unmatchedCharges > 0 ? "text-warning" : undefined}
          detail={tr("super.charges.stat.openDetail", { count: s.unmatchedCharges, pending: s.pendingReceipts })} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.charges.receipts")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.charges.table.date")}</th><th className={`${th} text-right`}>{tr("super.charges.table.total")}</th>
            <th className={th}>{tr("super.charges.table.state")}</th><th className={th}>{tr("super.charges.table.charge")}</th>
          </tr></thead>
          <tbody>
            {r.receipts.map(x => (
              <tr key={x.id} className="border-t border-line align-top">
                <td className="py-1 whitespace-nowrap"><Link href={`/receipts/${x.id}`} className="text-accent underline">{x.date}</Link></td>
                <td className="text-right font-mono">{fmtArsCents(x.totalCents)}</td>
                <td className={x.state === "matched" ? "text-positive" : x.state === "pending" ? "text-warning" : "text-ink-muted"}>
                  {tr(`super.charges.state.${x.state}`)}{x.method && <span className="text-xs text-ink-muted"> · {tr(`super.charges.method.${x.method}`)}</span>}
                </td>
                <td>
                  {x.charge && (
                    <form action={unlinkChargeAction} className="flex flex-wrap items-center gap-2">
                      <ChargeLine c={x.charge} tr={tr} />
                      <input type="hidden" name="receipt" value={x.id} />
                      <button type="submit" className={quiet}>{tr("super.charges.unlink")}</button>
                    </form>
                  )}
                  {!x.charge && x.candidates.map(c => (
                    <form key={c.fingerprint} action={linkChargeAction} className="flex flex-wrap items-center gap-2">
                      <ChargeLine c={c} tr={tr} />
                      <input type="hidden" name="receipt" value={x.id} />
                      <input type="hidden" name="fingerprint" value={c.fingerprint} />
                      <button type="submit" className={button}>{tr("super.charges.link")}</button>
                    </form>
                  ))}
                  {!x.charge && x.candidates.length === 0 && <span className="text-ink-subtle">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.charges.charges")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.charges.table.date")}</th><th className={th}>{tr("super.charges.table.card")}</th>
            <th className={th}>{tr("super.charges.table.description")}</th>
            <th className={`${th} text-right`}>{tr("super.charges.table.amount")}</th>
            <th className={th}>{tr("super.charges.table.installments")}</th>
            <th className={th}>{tr("super.charges.table.receipt")}</th>
          </tr></thead>
          <tbody>
            {r.charges.map(c => (
              <tr key={c.fingerprint} className="border-t border-line align-top">
                <td className="py-1 whitespace-nowrap">{c.date}</td>
                <td>{c.brand}</td>
                <td>{c.description}</td>
                <td className="text-right font-mono">{fmtArsCents(c.purchaseCents)}</td>
                <td className="text-xs text-ink-muted">
                  {c.installment_count && c.installment_count > 1
                    ? tr("super.charges.installmentOf", { n: c.installment_number ?? 1, of: c.installment_count, each: fmtArs(c.ars) })
                    : "—"}
                </td>
                <td>
                  {c.receiptId !== null ? (
                    <Link href={`/receipts/${c.receiptId}`} className="text-accent underline">{c.receiptDate}</Link>
                  ) : unlinkedReceipts.length === 0 ? (
                    <span className="text-warning">{tr("super.charges.noReceipt")}</span>
                  ) : (
                    // The user knows which trip this was; offer every receipt that has no charge yet.
                    <form action={linkChargeAction} className="flex items-center gap-2">
                      <input type="hidden" name="fingerprint" value={c.fingerprint} />
                      <select name="receipt" className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-xs text-ink" aria-label={tr("super.charges.linkTo")}>
                        {unlinkedReceipts.map(x => <option key={x.id} value={x.id}>{x.date} · {fmtArsCents(x.totalCents)}</option>)}
                      </select>
                      <button type="submit" className={quiet}>{tr("super.charges.link")}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.charges.footer")}</p>
    </main>
  );
}
```

`tr(\`super.charges.state.${x.state}\`)` and the `method` variant type-check because every combination exists as a key.

- [ ] **Step 5: Run the gates, look at it**

Run: `npx tsc --noEmit && npx vitest run` — green, `chrome.test.ts` sees the new route.

Browser (`tarjetas` on port 3000): `/super/charges` with the live database. Expected on this machine's data: the 2026-08-07 receipt shows matched · automatic to the Visa `MERPAGO*COTO` 115370.80; the 2026-08-14 receipt matched to the Mercado Pago charge "1 of 2 · $ 42.144 each"; receipts after the last ingested statement show "no charge yet"; the charges table lists every `COTO` purchase with its receipt or a select. Click Unlink on one, then Link it again through a candidate: both round-trips re-render the row. Español toggle changes every label.

- [ ] **Step 6: Commit**

```bash
git add src/app/super/charges src/components/Nav.tsx src/lib/chrome.ts src/lib/i18n.ts
git commit -m "feat(charges): reconciliation page — link, unlink, and the charges without a receipt"
```

---

### Task 5: The charge on the receipt page

**Files:**
- Modify: `web/src/app/receipts/[id]/page.tsx`, `web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `receiptSide` (Task 3); `linkChargeAction`, `unlinkChargeAction` (Task 4).

- [ ] **Step 1: Keys**

`en`:

```ts
  "receipts.detail.charge": "Card charge",
  "receipts.detail.charge.none": "No supermarket charge within three days of this receipt has been ingested yet.",
  "receipts.detail.charge.choose": "Two or more charges fit this receipt. Pick the one that paid it:",
  "receipts.detail.charge.cycle": "statement cycle {month}",
```

`es`:

```ts
  "receipts.detail.charge": "Cargo en la tarjeta",
  "receipts.detail.charge.none": "Todavía no se cargó ningún cargo de supermercado a menos de tres días de este ticket.",
  "receipts.detail.charge.choose": "Dos o más cargos encajan con este ticket. Elegí el que lo pagó:",
  "receipts.detail.charge.cycle": "ciclo del resumen {month}",
```

- [ ] **Step 2: The section**

In `web/src/app/receipts/[id]/page.tsx` add the imports:

```tsx
import { receiptSide } from "@/lib/receipts/charges";
import { fmtArs } from "@/lib/format";
import { linkChargeAction, unlinkChargeAction } from "@/app/super/charges/actions";
```

after `const d = receiptDetail(getDb(), n);` add `const side = receiptSide(getDb(), n)!;`, and insert this section right after the "Receipt facts" `<section>`:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.charge")}</h2>
        {side.charge && (
          <form action={unlinkChargeAction} className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <span className="font-medium">{side.charge.brand}</span> · {side.charge.date} · {side.charge.description} ·{" "}
              <span className="font-mono">{fmtArsCents(side.charge.purchaseCents)}</span>
              {side.charge.installment_count && side.charge.installment_count > 1 && (
                <span className="text-ink-muted"> · {side.charge.installment_count} × {fmtArs(side.charge.ars)}</span>
              )}
              <span className="text-ink-muted"> · {tr("receipts.detail.charge.cycle", { month: side.charge.cycle_month })}</span>
              <span className="text-xs text-ink-muted"> · {tr(`super.charges.method.${side.method!}`)}</span>
            </span>
            <input type="hidden" name="receipt" value={receipt.id} />
            <button type="submit" className="rounded-lg px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">{tr("super.charges.unlink")}</button>
          </form>
        )}
        {!side.charge && side.candidates.length === 0 && <p className="text-sm text-ink-muted">{tr("receipts.detail.charge.none")}</p>}
        {!side.charge && side.candidates.length > 0 && (
          <div className="space-y-2 text-sm">
            <p className="text-ink-muted">{tr("receipts.detail.charge.choose")}</p>
            {side.candidates.map(c => (
              <form key={c.fingerprint} action={linkChargeAction} className="flex flex-wrap items-center gap-3">
                <span>{c.brand} · {c.date} · {c.description} · <span className="font-mono">{fmtArsCents(c.purchaseCents)}</span></span>
                <input type="hidden" name="receipt" value={receipt.id} />
                <input type="hidden" name="fingerprint" value={c.fingerprint} />
                <button type="submit" className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90">{tr("super.charges.link")}</button>
              </form>
            ))}
          </div>
        )}
      </section>
```

`side` is non-null because `receiptDetail` already returned a row for the same id.

- [ ] **Step 3: Gates and a look**

Run: `npx tsc --noEmit && npx vitest run src/lib/i18n.test.ts src/lib/chrome.test.ts` — green. Browser: open the 2026-08-07 receipt: the section shows the Visa charge, cycle 2026-08, "automatic", an Unlink button. Open a receipt with no charge: the "not ingested yet" sentence.

- [ ] **Step 4: Commit**

```bash
git add "src/app/receipts/[id]/page.tsx" src/lib/i18n.ts
git commit -m "feat(charges): the receipt page shows the charge that paid it"
```

---

### Task 6: From a charge to its receipt in the categories drill

**Files:**
- Modify: `web/src/lib/queries.ts` (`BaseRow`, `baseRows`, `DrillRow`, `categoryDrill`), `web/src/app/categories/page.tsx`, `web/src/lib/i18n.ts`
- Test: `web/src/lib/queries.test.ts` (append)

**Interfaces:**
- Produces: `DrillRow.fingerprint: string | null`, `DrillRow.receiptId: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/queries.test.ts` (it already imports `openDb`, `ingestFile`, `categoryDrill`, the fixture, `rules` and `aliases`; add whatever of these is missing at the top):

```ts
describe("categoryDrill: receipt links", () => {
  it("carries the fingerprint of every row and the receipt id where one is linked", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules, aliases);
    const fp = (db.prepare("SELECT fingerprint FROM transactions WHERE description LIKE 'OSDE%' AND ars = 120000").get() as { fingerprint: string }).fingerprint;
    db.prepare(`INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
        header_json, verification_json, transcript_source, ocr_scale, created_at)
      VALUES ('coto', '2026-07-10', 'x', 'x', '/x', 12000000, 0, 12000000, '{}', '{}', 'ocr', 3, 'now')`).run();
    db.prepare("INSERT INTO receipt_charge_links (receipt_id, fingerprint, method, created_at) VALUES (1, ?, 'manual', 'now')").run(fp);
    const { rows } = categoryDrill(db, { value: "ars", spend: "cash", tax: "excl", base: "2026-07", mep: new Map(), cpi: { months: [], index: new Map() } } as never, { category: "health" });
    const linked = rows.find(r => r.fingerprint === fp)!;
    expect(linked.receiptId).toBe(1);
    expect(rows.filter(r => r.fingerprint !== fp).every(r => r.receiptId === null && r.fingerprint)).toBe(true);
  });
});
```

Look at how the existing `queries.test.ts` builds its `ValueOpts` (grep `valueOpts(` or `opts` near the top of the file) and construct the options the same way instead of the `as never` cast above — the cast is only there so this snippet stands alone.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts` — FAIL: `receiptId` undefined.

- [ ] **Step 3: Thread the fingerprint through**

In `web/src/lib/queries.ts`:

- `BaseRow` gains `fingerprint: string | null;` and `baseRows()` selects `t.fingerprint` (add it to the `SELECT` list).
- `DrillRow` gains `fingerprint: string | null; receiptId: number | null;`.
- In `categoryDrill`, before the loop: `const linked = new Map((db.prepare("SELECT fingerprint, receipt_id FROM receipt_charge_links").all() as { fingerprint: string; receipt_id: number }[]).map(l => [l.fingerprint, l.receipt_id]));` and in the `rows.push({...})` add `fingerprint: r.fingerprint, receiptId: r.fingerprint ? linked.get(r.fingerprint) ?? null : null`.

Every other consumer of `BaseRow` ignores the new field; `tsc` will point at any object literal of type `DrillRow` elsewhere (there are none outside `categoryDrill`).

- [ ] **Step 4: Show it**

`en`: `"categories.table.receipt": "receipt",` — `es`: `"categories.table.receipt": "ticket",`.

In `web/src/app/categories/page.tsx`, inside the description cell (`<td>` holding `r.merchant` and `r.description`), after the description span:

```tsx
                        {r.receiptId !== null && (
                          <Link href={`/receipts/${r.receiptId}`} className="block text-xs text-accent hover:underline">
                            {tr("categories.table.receipt")}
                          </Link>
                        )}
```

Add `import Link from "next/link";` if the page does not import it yet.

- [ ] **Step 5: Gates, commit**

Run: `npx tsc --noEmit && npx vitest run` — green. Browser: `/categories?category=food&subcategory=supermarket`: the `MERPAGO*COTO` row of 2026-08-07 shows a "receipt" link under its description; it opens the receipt.

```bash
git add src/lib/queries.ts src/lib/queries.test.ts src/app/categories/page.tsx src/lib/i18n.ts
git commit -m "feat(charges): a linked charge in the drill table points at its receipt"
```

---

### Task 7: Documentation

**Files:**
- Modify: `web/README.md` ("Supermarket receipts" section)

- [ ] **Step 1: Document reconciliation**

Append:

```markdown
**Charges.** Every statement line gets a `fingerprint` at ingest (a hash of card, date, printed
description, amounts and installment position — stable across re-ingests, unlike the row id; older
rows are backfilled by `migrate()`). `receipt_charge_links` ties one receipt to one fingerprint.
After a receipt is stored and after a statement is ingested, a receipt with exactly one candidate
charge (supermarket purchase, first installment, within ±3 days, same amount or amount × installments)
is linked automatically; `/super/charges` shows both sides, lets you link or unlink by hand, and
lists the supermarket charges with no receipt. Linking never edits a charge or a receipt.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: receipt–charge reconciliation"
```

---

## Self-review

**Spec coverage (§9 and decision 18 of `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`):**

| Spec | Task |
|---|---|
| Stable `transactions.fingerprint` computed at ingest | 1 (plus backfill for existing rows) |
| `receipt_charge_links` (receipt UNIQUE, fingerprint UNIQUE, method) | 2 |
| Candidate: supermarket purchase, ±3 days, `ars == total` or `ars × installment_count == total` | 2 (`amountMatches`, `candidateCharges`) |
| One candidate → matched (auto); several → pending; none → unmatched | 2 (`autoLink`), 3 (`receiptSide` states) |
| Manual link and unlink always | 2, 4, 5 |
| Reconciliation never edits either side | 2 (only `receipt_charge_links` is written) |
| Supermarket charges with no receipt listed | 3, 4 |
| Charge side gains item detail (link to receipt); receipt side gains payment context (card, cycle, installments) | 5, 6 |
| Runs after receipt store and after statement ingest | 2 Step 6 |

**States** are derived, not stored: matched = a link exists; pending = no link and ≥ 2 candidates; unmatched = no link and no candidate. A stored "pending" would go stale the moment a statement arrives.

**Placeholder scan:** no "TBD", "TODO", "similar to Task N", or "add validation"; every code step shows the code. Task 6's test carries one explicit `as never` with instructions to replace it with the file's own option builder.

**Type consistency:** `ChargeRef`, `ReceiptSide`, `ChargeSide`, `Reconciliation`, `LinkMethod`, `AutoLinkReport` are defined in `charges.ts` and consumed by name in Tasks 4–5. `fingerprintAll(brand, txs)` is called with `json.transactions` (whose element type has the six non-brand identity fields) in Task 1 and with the backfill rows. `linkReceipt(db, receiptId, fingerprint, method?)` matches its action and tests. `receiptSide` returns `method` on the matched branch, which Task 5 reads.

**Out of scope, on purpose:** receipts paid with two cards or partially in cash; a stored "no receipt exists for this charge" dismissal; matching statements that carry the Mercado Pago voucher number (not stored today).
