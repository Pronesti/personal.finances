# Phase 2 Depth Implementation Plan (rev A — post-review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the Phase 1 dashboard: merchant identity (alias map), a third value mode (USD at MEP) and a tax-inclusive "true cost" toggle, an anomaly engine, a 3-layer cuota/spend projection, the personal-inflation lens, plus Sankey and calendar-heatmap charts.

**Architecture:** No new services, no new storage layer. Everything extends the existing shape: pure functions in `web/src/lib/`, SQLite read through `queries.ts`, Recharts client components, modes carried as URL search params. The alias map is a second ordered JSON rules file applied at ingest; MEP is a second month-keyed table reusing CPI's lookup; anomalies and projections are computed at query time (no new tables, no staleness) — only ingest-time *integrity* alerts stay persisted, as in Phase 1.

**Tech Stack:** Next.js 16 (App Router, TS), better-sqlite3, Recharts 3 (incl. its built-in `Sankey`), Tailwind 4, vitest, tsx. No new dependencies.

**Spec:** `docs/analysis.md` (§3 analyses, §4 charts 2/3/4/8/9/10, §5 projection layers, §6 currency & inflation). Research: `docs/research-financial-apps.md`. Predecessor: `docs/superpowers/plans/2026-08-25-phase1-dashboard.md` (its **Review Revisions** are binding).

---

## Inherited Decisions (do not revert)

Phase 1's "Review Revisions" stay in force. The ones this plan touches:

1. **Months are `cycle_month`** (billing-cycle midpoint), never `closing_date.slice(0,7)`.
2. **Negative purchases are kept** — refunds/bonifications/reversals net against spend.
3. **USD-only rows never enter ARS aggregates.** Phase 2 changes this in exactly one place: in the new **USD value mode** those rows *are* the truth and finally count (spec §6). They stay excluded from `nominal`/`real`.
4. **Accrual uses the first-*observed* cuota**: for a series whose lowest seen `installment_number` is k, count `ars × (count − k + 1)` at that month; all other cuota rows are excluded.
5. **Integrity checks run at ingest** and persist to `alerts`. Anomalies (this plan) are *not* persisted — they depend on cross-statement history and CPI, so they are computed per query.
6. **Rule order matters** (first match wins). The new alias file uses the same convention.
7. **Latest statement per brand**, never `LIMIT 1` — two cards close the same day, and an older statement's `upcoming_installments` is superseded by the newer one's.

## Review Findings Folded In (2026-08-25)

This revision incorporates a 3-lens pre-execution review (standards / simplicity / correctness-vs-real-data). Every claim below was verified by query against the real `data/app.db` and `json/`. **These are decisions an executor must not "fix" backward.**

1. **`merchant|installment_count` is not a cuota series key.** Real data: `MERCADOLIBRE|6` covers **six** distinct purchase dates; `MOVISTAR ARENA|6` covers three. The first-observed-k rule (rev note 4) silently drops or inflates whole series. The key is `merchant|installment_count|date`. This is a **live Phase 1 defect**, not something aliasing introduces — but aliasing makes it worse, so it is fixed in the same breath (Task 2).
2. **Recurring detection must net negatives before testing positivity.** Phase 1 filters `ars > 0` per row, so the three reversed double-charges on the 2026-07 statement are counted twice everywhere except the duplicate detector. Netting per merchant-month removes **564,675 ARS/month** of phantom from the projection's expected layer and swings the personal-inflation index by 55 points (196.5 → 141.9 vs INDEC's 153.6 — i.e. it flips the headline from "you pay more than average" to "less"). Rev note 2 already demanded this; Phase 1 only honoured it in the ARS aggregates.
3. **`DEVOLUCION DE SALDOS` is not a tax.** It is a balance transfer — the bank returning a credit balance to the account, which correctly *increases* the statement balance. Verified: `visa_2025_07_31` reconciles exactly (3,197,399.27 + 2,036,395.24 + 2,489,042.09 − 4,642,419.49 = 3,080,417.11 = SALDO ACTUAL). Do **not** flip its sign. Exclude it from the tax numerator instead.
4. **RG 5617's tax base is USD spend**, which is absent from an ARS-only denominator. Verified: `visa_2025_06_26` charges `DB.RG 5617 30% ( 4819784,31 )` against 4,045 USD of foreign purchases while ARS purchases were only 1,749,872. With (3) and (4) fixed, the worst pro-rata multiplier falls from **×2.222 to ×1.221** — the difference between a broken toggle and a usable one.
5. **Duplicate detection must be same-statement.** Cross-card matching flags two real HOYTS cinema purchases made on both cards the same day (statements 32 and 48). Constraining to one statement yields exactly the 3 genuine 2026-07 duplicates, all correctly marked resolved.
6. **Amount-jump detection must gate on one charge per month.** Ungated it fires **42 alerts** over 19 months and measures *volume*, not price — COTO (a supermarket visited 1–5×/month), YPF, tolls and tips dominate. Gating to merchants billed exactly once in both compared months, at >25% real, yields **6 alerts**: a signal, not a wall.
7. **Recurring needs a recency gate before it can be projected.** `detectRecurring` has none, so a subscription cancelled in 2025 is projected into 2027. Only merchants last seen within the trailing two cycles enter the expected layer.
8. **Money formatting must follow the value mode.** Phase 1's charts hardcode `fmtArs`; adding a USD mode without threading the mode through renders `US$ 3.73` as `$ 4`. One `fmtMoney(n, value)` helper, one `value` prop on every chart.
9. **Sankey flows must be derived from one netted map.** Accumulating brand→category and category→merchant independently and dropping non-positives from each breaks flow conservation in 6 of 19 real months. Keying `brand|category|merchant` once and deriving both sides from the survivors conserves by construction — and is less code.
10. **`/recurring` stays nominal-only by design.** Its whole point is that the nominal month-over-month change *is* the price-hike signal; its subtitle already says so. It gets no `ModeToggle`.

## Global Constraints

- All lib code in `web/src/lib/`, one responsibility per file. Pure functions in, data out — DB touched only in `db.ts` and `queries.ts`.
- Value modes: `real` (default, constant pesos, base = latest CPI month), `nominal`, `usd` (MEP). Spend modes: `accrual` (default), `cash`. Tax mode: `excl` (default), `incl`. All travel as URL search params and survive navigation.
- Zero LLM calls. Categorization stays rules-only (LLM flow is Phase 3, spec §7).
- UI copy in English; merchant/category names as-is.
- Money display goes through `fmtMoney(n, value)` — never `fmtArs` directly in a component that can render USD.
- No `as any` in tests; fixtures typed with `satisfies`.
- **Prefer deleting code over adding abstractions.** This is a single-user local app. Several tasks below consolidate or delete Phase 1 code; that is part of the task, not optional cleanup. Tuned constants that this dataset determined (`MIN_AMOUNT`, `DAY_WINDOW`, `JUMP_PCT`, `TOP_MERCHANTS`) are module constants, **not** options parameters — nothing varies them.
- Node ≥ 20. `data/app.db` gitignored; `data/*.json` committed. CLI scripts end with `main().catch(e => { console.error(e); process.exit(1); })` and name the offending file in errors.
- Commit after every task. Repo root is the git root; the Next app lives in `web/`.
- Every task ends with `cd web && npm test` green before its commit.

---

### Task 1: Merchant identity — month helpers, alias map, currency-tail fix

Fixes the Phase 1 deferral (rev note 7). Real data confirms the damage: **17** distinct `GOOGLE YOUTUBEP P1…` merchants for one monthly subscription; HBO Max split **three** ways (`HELP MAX COM` ×7 — the earliest naming, sitting in category `other` — plus `HELP HBOM` ×4 and `HELP HBOMAX COM` ×8); `PERSONAL` vs `PERSONAL FLOW`; `MOVISTAR AR`/`AREN`/`ARENA`; 3 `CARREFOUR` branches; 4 `JUMBO` branches; 6 `APPYPF … COMBUST`. Two cuota series are split by PDF truncation (`CASASSA Y LORENZO LI`/`LIBR`, `LEF CASA DE MUSICA S`/`SA - S`), which double-counts them in accrual mode. And `USD_TAIL_RE` fails on space-separated thousands, baking amounts into merchant names (`APPLE COM/US USD 3 262,43`, `CABIFY2612EWOUEFC CLP 4 220,00`) so every future occurrence fakes a brand-new merchant.

**Files:**
- Create: `web/src/lib/months.ts`, `web/src/lib/aliases.ts`, `data/merchant-aliases.json`
- Test: `web/src/lib/aliases.test.ts`
- Modify: `web/src/lib/recurring.ts` (delete its private month helpers), `web/src/lib/categorize.ts`, `web/src/lib/categorize.test.ts`, `web/src/lib/ingest.ts`, `web/src/lib/ingest.test.ts`, `web/scripts/ingest.ts`, `data/merchant-categories.json`

**Interfaces:**
- Produces:
  - `addMonth(month: string, n?: number): string`, `monthsBetween(a: string, b: string): number` (inclusive span) — `months.ts`
  - `type Alias = { match: string; alias: string }`; `loadAliases(): Alias[]`; `applyAlias(merchant: string, aliases: Alias[]): string` — **prefix** match, first match wins
  - `categorize(merchant: string, section: string, rules: Rule[])` — signature change: takes the normalized+aliased merchant, no longer re-normalizes internally
  - `statementToRows(json, rules, aliases)` / `ingestFile(db, json, rules, aliases)` — third parameter added
- Consumes: `normalizeMerchant` (regex widened, same signature).

**Why prefix, not substring:** `PEDIDOSYA PLUS` (a subscription) and `PEDIDOSYA MCDONALDS FLO` (a delivery order) must stay distinct, so no broad `PEDIDOSYA` entry exists. Substring matching would merge them.

- [ ] **Step 1: Write the failing test**

`web/src/lib/aliases.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyAlias, type Alias } from "@/lib/aliases";
import { normalizeMerchant } from "@/lib/categorize";
import { addMonth, monthsBetween } from "@/lib/months";

const aliases: Alias[] = [
  { match: "PEDIDOSYA PLUS", alias: "PEDIDOSYA PLUS" },
  { match: "PEDIDOSYA PROPINA", alias: "PEDIDOSYA PROPINA" },
  { match: "GOOGLE YOUTUBEP", alias: "GOOGLE YOUTUBE PREMIUM" },
  { match: "HELP HBOM", alias: "HBO MAX" },
  { match: "HELP MAX COM", alias: "HBO MAX" },
  { match: "SANCOR COOP", alias: "SANCOR" },
  { match: "PERSONAL", alias: "PERSONAL" },
  { match: "MOVISTAR AR", alias: "MOVISTAR ARENA" },
  { match: "CARREFOUR", alias: "CARREFOUR" },
  { match: "LEF CASA DE MUSICA", alias: "LEF CASA DE MUSICA" },
];

describe("applyAlias", () => {
  it("collapses the 17 GOOGLE YOUTUBEP token variants into one merchant", () => {
    expect(applyAlias("GOOGLE YOUTUBEP P18NBKWS", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
    expect(applyAlias("GOOGLE YOUTUBEP P1MD102O", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
    expect(applyAlias("GOOGLE YOUTUBEPREMIUM", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
  });
  it("unifies all three HBO Max namings, including the oldest", () => {
    expect(applyAlias("HELP HBOM", aliases)).toBe("HBO MAX");
    expect(applyAlias("HELP HBOMAX COM", aliases)).toBe("HBO MAX");
    expect(applyAlias("HELP MAX COM", aliases)).toBe("HBO MAX");
  });
  it("unifies truncated and punctuated variants (rev note 7)", () => {
    expect(applyAlias("PERSONAL FLOW", aliases)).toBe("PERSONAL");
    expect(applyAlias("SANCOR COOP SE0000012345678-020-000", aliases)).toBe("SANCOR");
    expect(applyAlias("MOVISTAR AREN", aliases)).toBe("MOVISTAR ARENA");
  });
  it("rejoins cuota series split by PDF truncation", () => {
    expect(applyAlias("LEF CASA DE MUSICA S", aliases)).toBe("LEF CASA DE MUSICA");
    expect(applyAlias("LEF CASA DE MUSICA SA - S", aliases)).toBe("LEF CASA DE MUSICA");
  });
  it("merges store branches so branch names stop faking new merchants", () => {
    expect(applyAlias("CARREFOUR VILLA DEVOTO", aliases)).toBe("CARREFOUR");
    expect(applyAlias("CARREFOUR VELEZ SARSFIELD", aliases)).toBe("CARREFOUR");
  });
  it("is prefix-matched and first-match-wins, so PedidosYa stays split by product", () => {
    expect(applyAlias("PEDIDOSYA PLUS", aliases)).toBe("PEDIDOSYA PLUS");
    expect(applyAlias("PEDIDOSYA PROPINAS", aliases)).toBe("PEDIDOSYA PROPINA");
    expect(applyAlias("PEDIDOSYA MCDONALDS FLO", aliases)).toBe("PEDIDOSYA MCDONALDS FLO");
  });
  it("passes unknown merchants through untouched", () => {
    expect(applyAlias("XYZ RANDOM SHOP", aliases)).toBe("XYZ RANDOM SHOP");
  });
});

describe("normalizeMerchant currency tails", () => {
  it("strips amounts that use spaces as thousands separators", () => {
    expect(normalizeMerchant("APPLE.COM/US USD 3 262,43")).toBe("APPLE COM/US");
    expect(normalizeMerchant("NATIONAL CAR RENTAL USD 1 303,52")).toBe("NATIONAL CAR RENTAL");
  });
  it("strips non-USD currency tails too", () => {
    expect(normalizeMerchant("MERPAGO*CABIFY2612EWOUEFC CLP 4 220,00")).toBe("CABIFY2612EWOUEFC");
    expect(normalizeMerchant("MIRADOR COSTANERA CENTER CLP 46 000,00")).toBe("MIRADOR COSTANERA CENTER");
  });
  it("still handles the Phase 1 cases", () => {
    expect(normalizeMerchant("Spotify USD 3,73")).toBe("SPOTIFY");
    expect(normalizeMerchant("APPLE.COM/BILL MT8ZSVB45USD 9,99")).toBe("APPLE COM/BILL");
  });
});

describe("months", () => {
  it("adds months across year boundaries", () => {
    expect(addMonth("2026-07")).toBe("2026-08");
    expect(addMonth("2026-12")).toBe("2027-01");
    expect(addMonth("2026-11", 3)).toBe("2027-02");
    expect(addMonth("2026-01", -2)).toBe("2025-11");
  });
  it("measures inclusive spans", () => {
    expect(monthsBetween("2026-01", "2026-01")).toBe(1);
    expect(monthsBetween("2025-11", "2026-02")).toBe(4);
  });
});
```

`web/src/lib/categorize.test.ts` — `categorize` now takes a merchant, so its four call sites must feed it one. Make exactly these edits:

- `categorize("292746*MOVISTAR AREN", "purchases", rules)` → `categorize(normalizeMerchant("292746*MOVISTAR AREN"), "purchases", rules)`
- inside the drifted-variants loop, `categorize(d, "purchases", rules)` → `categorize(normalizeMerchant(d), "purchases", rules)`
- `categorize("IVA RG 4240 21%( 37759,04)", "taxes_and_charges", rules)` → `categorize(normalizeMerchant("IVA RG 4240 21%( 37759,04)"), "taxes_and_charges", rules)`
- `categorize("XYZ RANDOM SHOP", "purchases", rules)` → `categorize(normalizeMerchant("XYZ RANDOM SHOP"), "purchases", rules)`

Then change that file's local `rules` fixture entry `{ match: "HBOM", ... }` to `{ match: "HBO MAX", category: "subscriptions", subcategory: "streaming" }`, update the drifted-variants loop to expect the aliased name, and append:
```ts
describe("categorize on aliased merchants", () => {
  it("matches rules written for the canonical alias names", () => {
    expect(categorize("HBO MAX", "purchases", rules).category).toBe("subscriptions");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/aliases.test.ts src/lib/categorize.test.ts`
Expected: FAIL — `Cannot find module '@/lib/aliases'`.

- [ ] **Step 3: Implement**

`web/src/lib/months.ts`:
```ts
export function addMonth(month: string, n = 1): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Inclusive span: monthsBetween("2026-01", "2026-01") === 1.
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
```

`web/src/lib/aliases.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export type Alias = { match: string; alias: string };

export function loadAliases(): Alias[] {
  const p = path.join(DATA_DIR, "merchant-aliases.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).aliases as Alias[];
}

// Prefix match, first match wins — same ordering convention as merchant-categories.json.
// Prefix (not substring) so "PEDIDOSYA PLUS" stays distinct from "PEDIDOSYA MCDONALDS FLO".
export function applyAlias(merchant: string, aliases: Alias[]): string {
  for (const a of aliases) if (merchant.startsWith(a.match)) return a.alias;
  return merchant;
}
```

`web/src/lib/categorize.ts` — widen the currency-tail regex and stop re-normalizing. Replace `USD_TAIL_RE` and `categorize`:
```ts
// Trailing "<CUR> 1 234,56" amounts — Argentine statements use spaces as thousands separators,
// and glue the code to a voucher ("MT8ZSVB45USD 9,99"). Without the \s the amount becomes
// part of the merchant name and every occurrence looks like a brand-new merchant.
const USD_TAIL_RE = /\s*\S*(USD|CLP|EUR|BRL|UYU)\s*[\d.,\s]+$/i;
```
```ts
export function categorize(
  merchant: string,
  section: string,
  rules: Rule[]
): { category: Category; subcategory: string | null } {
  if (section === "taxes_and_charges") return { category: "taxes_fees", subcategory: null };
  for (const r of rules) {
    if (merchant.includes(r.match.toUpperCase())) {
      return { category: r.category, subcategory: r.subcategory ?? null };
    }
  }
  return { category: "other", subcategory: null };
}
```

`data/merchant-aliases.json` (**ordered** — longer prefixes first):
```json
{
  "aliases": [
    { "match": "PEDIDOSYA PLUS", "alias": "PEDIDOSYA PLUS" },
    { "match": "PEDIDOSYA PROPINA", "alias": "PEDIDOSYA PROPINA" },
    { "match": "PEDIDOS YA - PROPINA", "alias": "PEDIDOSYA PROPINA" },
    { "match": "BONIF CONSUMO PEDIDOSYA", "alias": "PEDIDOSYA PLUS" },
    { "match": "GOOGLE YOUTUBEP", "alias": "GOOGLE YOUTUBE PREMIUM" },
    { "match": "HELP HBOM", "alias": "HBO MAX" },
    { "match": "HELP MAX COM", "alias": "HBO MAX" },
    { "match": "SANCOR COOP", "alias": "SANCOR" },
    { "match": "PERSONAL", "alias": "PERSONAL" },
    { "match": "MOVISTAR AR", "alias": "MOVISTAR ARENA" },
    { "match": "CARREFOUR", "alias": "CARREFOUR" },
    { "match": "COTO SUCURSAL", "alias": "COTO" },
    { "match": "DIA TIENDA", "alias": "DIA" },
    { "match": "JUMBO", "alias": "JUMBO" },
    { "match": "APPYPF", "alias": "YPF" },
    { "match": "MC DONALD", "alias": "MC DONALDS" },
    { "match": "MCDONALDS", "alias": "MC DONALDS" },
    { "match": "APPLE COM/BILL", "alias": "APPLE COM/BILL" },
    { "match": "APPLE COM BILL", "alias": "APPLE COM/BILL" },
    { "match": "OPENAI CHATGPT", "alias": "OPENAI CHATGPT" },
    { "match": "MERCH OFICIAL", "alias": "MERCH OFICIAL" },
    { "match": "MERCHOFICIAL", "alias": "MERCH OFICIAL" },
    { "match": "NICKYCHEESE", "alias": "NICKYCHEESE" },
    { "match": "CASASSA Y LORENZO", "alias": "CASASSA Y LORENZO" },
    { "match": "LEF CASA DE MUSICA", "alias": "LEF CASA DE MUSICA" },
    { "match": "OREGON HOTEL", "alias": "OREGON HOTEL SABANAS" }
  ]
}
```
Entries whose `match` equals their `alias` are not no-ops: prefix-match-first-wins truncates every longer variant onto the short canonical name (`PERSONAL FLOW` → `PERSONAL`, `JUMBO PALERMO` → `JUMBO`).

`data/merchant-categories.json` — aliasing renames two merchants out of range of their old rules. **Replace** (do not duplicate) these two entries; after a re-ingest no row can ever hold the old spellings again, because `ingestFile` deletes and re-inserts each statement from source:
- `{ "match": "HBOM", ... }` → `{ "match": "HBO MAX", "category": "subscriptions", "subcategory": "streaming" }`
- `{ "match": "YOUTUBEPREMIUM", ... }` → `{ "match": "YOUTUBE PREMIUM", "category": "subscriptions", "subcategory": "streaming" }`

`web/src/lib/recurring.ts` — delete the private `monthsBetween` and `addMonth` (lines 14–23) and import them instead:
```ts
import { addMonth, monthsBetween } from "@/lib/months";
```

`web/src/lib/ingest.ts` — thread aliases through and stop double-normalizing. Add the import:
```ts
import { applyAlias, type Alias } from "@/lib/aliases";
```
Change the two signatures and the row mapping:
```ts
export function statementToRows(json: StatementJson, rules: Rule[], aliases: Alias[]) {
```
```ts
  const transactions = json.transactions.map(t => {
    const merchant = applyAlias(normalizeMerchant(t.description), aliases);
    const { category, subcategory } = categorize(merchant, t.section, rules);
    return {
      section: t.section,
      date: t.date,
      description: t.description,
      merchant,
      category, subcategory,
      ars: t.ars, usd: t.usd,
      installment_number: t.installment_number,
      installment_count: t.installment_count,
    };
  });
```
```ts
export function ingestFile(db: Database.Database, json: StatementJson, rules: Rule[], aliases: Alias[]): void {
  const { statement, transactions, installments, alerts } = statementToRows(json, rules, aliases);
```
(the rest of `ingestFile` is unchanged).

`web/src/lib/ingest.test.ts` — add near the `rules` fixture:
```ts
import type { Alias } from "@/lib/aliases";
const aliases: Alias[] = [{ match: "OSDE", alias: "OSDE" }];
```
then change `statementToRows(x, rules)` → `statementToRows(x, rules, aliases)` (two sites) and `ingestFile(db, x, rules)` → `ingestFile(db, x, rules, aliases)` (two sites).

`web/scripts/ingest.ts`:
```ts
import { loadAliases } from "../src/lib/aliases";
```
```ts
  const rules = loadRules();
  const aliases = loadAliases();
```
```ts
      ingestFile(db, json, rules, aliases);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS (all files).

- [ ] **Step 5: Re-ingest and verify the real splits are gone**

Run: `cd web && npm run ingest`
Expected: `done: 27 statements, 0 integrity alerts`.

From the repo root:

Run: `sqlite3 data/app.db "SELECT COUNT(*) FROM transactions WHERE merchant IN ('HBO MAX','GOOGLE YOUTUBE PREMIUM');"`
Expected: `38` — HBO Max's three namings unify to **19** rows (4 + 8 + 7) and YouTube Premium's variants to **19**. If you get 31, the `HELP MAX COM` alias is missing.

Run: `sqlite3 data/app.db "SELECT merchant, COUNT(*) FROM transactions WHERE merchant LIKE 'HELP%' OR merchant LIKE 'PERSONAL FLOW%' OR merchant LIKE 'GOOGLE YOUTUBEP P%' OR merchant LIKE 'LEF CASA%' OR merchant LIKE 'CASASSA%LI%' GROUP BY 1;"`
Expected: no rows.

Run: `sqlite3 data/app.db "SELECT category, COUNT(*) FROM transactions WHERE merchant IN ('HBO MAX','GOOGLE YOUTUBE PREMIUM') GROUP BY 1;"`
Expected: a single `subscriptions|38` row (proves the two replaced category rules landed and that `HELP MAX COM`'s 7 previously-`other` rows are now filed correctly).

Run: `sqlite3 data/app.db "SELECT COUNT(*) FROM transactions WHERE section='purchases' AND merchant GLOB '*[0-9] [0-9][0-9][0-9],[0-9][0-9]';"`
Expected: `0` (no amounts baked into merchant names). Restrict to `purchases`: three `taxes_and_charges` rows are named `DB IVA $ 21% 2 069,63` and similar, where the merchant column is meaningless — `categorize` short-circuits on the section before ever reading it.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/months.ts web/src/lib/aliases.ts web/src/lib/aliases.test.ts \
        web/src/lib/categorize.ts web/src/lib/categorize.test.ts web/src/lib/recurring.ts \
        web/src/lib/ingest.ts web/src/lib/ingest.test.ts web/scripts/ingest.ts \
        data/merchant-aliases.json data/merchant-categories.json
git commit -m "feat: merchant alias map unifying split merchant identities"
```

---

### Task 2: Fix two latent Phase 1 amount defects (cuota series key, recurring netting)

Both are live bugs in Phase 1 that Task 1 amplifies, both tiny, both verified against real data (folded-in findings 1 and 2). Doing them together because they are judged by one question: *do the real totals become correct?*

**Defect A — the cuota series key.** `amountCtx` keys first-observed-k by `merchant|installment_count`. That is not a series identifier:
```
MERCADOLIBRE   | 6 | 6 distinct purchase dates
MOVISTAR ARENA | 6 | 3 distinct purchase dates (2024-12-09, 2026-03-05, 2026-03-10)
```
When two series share a key, the lowest k across all of them wins, so every row of the later-starting series is discarded. Post-alias this silently deletes the Mastercard's only 2026 purchase (−135,000 ARS in 2026-06). The purchase `date` is constant across every row of a real series — verified on all 27 statements — so it completes the key.

**Defect B — recurring ignores reversals.** `detectRecurring` filters `ars > 0` *per row*, so an offsetting −273,395.99 never nets against its +273,395.99 pair. Netting per merchant-month and dropping non-positive months is what rev note 2 already asked for.

**Files:**
- Modify: `web/src/lib/queries.ts`, `web/src/lib/queries.test.ts`, `web/src/lib/recurring.ts`, `web/src/lib/recurring.test.ts`

**Interfaces:** no signature changes. `amountCtx`'s `minK` map is keyed `merchant|installment_count|date`; `detectRecurring` nets before filtering.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/queries.test.ts`:
```ts
describe("cuota series identity", () => {
  it("keys each series by its purchase date — two series, one merchant, one count", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', ?, 'ML', 'MERCADOLIBRE', 'shopping', NULL, 1000, NULL, ?, 6)`
    );
    ins.run(sid, "2026-01-05", 1);  // series A, first cuota observed
    ins.run(sid, "2026-05-20", 4);  // series B, first observed at k=4
    const shopping = monthlySpendByCategory(db, o("accrual", "nominal"))
      .filter(r => r.month === "2026-07" && r.category === "shopping")
      .reduce((s, r) => s + r.amount, 0);
    // A: 1000 x 6 = 6000. B: 1000 x (6-4+1) = 3000. Plus the seeded TIENDA 100 x (6-3+1) = 400.
    expect(shopping).toBeCloseTo(9400, 6);
  });
});
```

Append to `web/src/lib/recurring.test.ts`:
```ts
describe("netting reversals", () => {
  it("nets an offsetting reversal instead of counting the charge twice", () => {
    const r = detectRecurring([
      ars("OSDE", "2026-04", 100), ars("OSDE", "2026-05", 100),
      ars("OSDE", "2026-06", 100), ars("OSDE", "2026-06", 100), ars("OSDE", "2026-06", -100),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].lastAmount).toBe(100);   // not 200
    expect(r[0].pctChange).toBe(0);
  });
  it("drops a month that nets to zero rather than treating it as an occurrence", () => {
    const r = detectRecurring([
      ars("GYM", "2026-01", 500), ars("GYM", "2026-02", 500), ars("GYM", "2026-03", 500),
      ars("GYM", "2026-04", 500), ars("GYM", "2026-04", -500),
    ]);
    expect(r[0].occurrences).toBe(3);
    expect(r[0].lastMonth).toBe("2026-03");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/queries.test.ts src/lib/recurring.test.ts`
Expected: FAIL — shopping totals 6400 (series B swallowed), and `lastAmount` 200 instead of 100.

- [ ] **Step 3: Implement**

`web/src/lib/queries.ts` — in `amountCtx`, add the date to the key:
```ts
  const minK = new Map<string, number>();
  for (const r of rows) {
    if (r.installment_count == null || r.installment_number == null) continue;
    // merchant+count is NOT a series id — MERCADOLIBRE|6 covers six distinct purchases.
    // The purchase date is constant across a real series, so it completes the key.
    const key = `${r.merchant}|${r.installment_count}|${r.date ?? ""}`;
    const cur = minK.get(key);
    if (cur === undefined || r.installment_number < cur) minK.set(key, r.installment_number);
  }
```
and in `effectiveAmount`, use the same key:
```ts
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}|${r.date ?? ""}`)!;
```

`web/src/lib/recurring.ts` — net before testing positivity. Replace the grouping loop and the month filter:
```ts
  const groups = new Map<string, Map<string, number>>(); // "merchant|currency" -> month -> netted amount
  for (const r of rows) {
    if (r.installment_count != null) continue;
    let currency: "ARS" | "USD"; let amount: number;
    // Negatives ride along and net (rev note 2): a reversed double-charge is one charge,
    // not two, and a fully-reversed month is not an occurrence at all.
    if (r.ars != null) { currency = "ARS"; amount = r.ars; }
    else if (r.usd != null) { currency = "USD"; amount = r.usd; }
    else continue;
    const key = `${r.merchant}|${currency}`;
    const months = groups.get(key) ?? new Map();
    months.set(r.month, (months.get(r.month) ?? 0) + amount);
    groups.set(key, months);
  }
  const out: RecurringCharge[] = [];
  for (const [key, months] of groups) {
    const [merchant, currency] = key.split("|") as [string, "ARS" | "USD"];
    const sorted = [...months.keys()].filter(m => months.get(m)! > 0).sort();
```
(the rest of the loop body — the `minMonths`/`minDensity` checks and the push — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Verify the real totals moved the right way**

From the repo root, confirm the previously-swallowed Mastercard series is back:

Run: `sqlite3 data/app.db "SELECT s.brand, s.cycle_month, t.date, t.installment_number, t.installment_count, t.ars FROM transactions t JOIN statements s ON s.id=t.statement_id WHERE t.merchant='MOVISTAR ARENA' AND t.installment_count=6 ORDER BY t.date, t.installment_number;"`
Expected: three distinct purchase dates (2024-12-09, 2026-03-05, 2026-03-10). Under the old key all but the 2024-12-09 series' rows were discarded; under the new key each is its own series.

Then start the dev server and open `/trends` in **accrual** mode: 2026-06 must show a non-zero Mastercard contribution, and 2025-04 shopping must drop by ~449,000 ARS (the `LEF CASA DE MUSICA` series is no longer double-counted now that Task 1 merged its two spellings and this task keys it once).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts web/src/lib/recurring.ts web/src/lib/recurring.test.ts
git commit -m "fix: key cuota series by purchase date, net reversals in recurring detection"
```

---

### Task 3: MEP rate table + shared month lookup (`mep.ts`, `scripts/fetch-mep.ts`)

Source verified live: `https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa` returns a daily array of `{ casa, compra, venta, fecha }` from 2018-10-29 to today (2,857 rows). We store the **monthly mean of `venta`**, because every aggregate in this app is keyed by `cycle_month`; per-day precision buys nothing for monthly charts.

`mepFor` would otherwise be a verbatim copy of `cpi.ts`'s private `indexFor`, so this task **exports one shared lookup** from `cpi.ts` and leaves `mep.ts` at 12 lines.

**Files:**
- Create: `web/src/lib/mep.ts`, `web/scripts/fetch-mep.ts`, `data/mep.json` (produced by the fetcher, committed as cache — spec §6)
- Test: `web/src/lib/mep.test.ts`
- Modify: `web/src/lib/cpi.ts`, `web/package.json`

**Interfaces:**
- Produces:
  - `monthValue(month: string, table: Record<string, number>, remedy: string): number` — `cpi.ts`; exact hit, else nearest **earlier** month, else throws naming `remedy`
  - `type MepTable = Record<string, number>` (`"YYYY-MM"` → ARS per USD); `mepFor(month, table): number`; `loadMep(): MepTable` — `mep.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/mep.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mepFor } from "@/lib/mep";

const table = { "2025-01": 1100, "2025-02": 1150, "2025-04": 1300 };

describe("mepFor", () => {
  it("returns the month's rate, else the nearest earlier one", () => {
    expect(mepFor("2025-02", table)).toBe(1150);
    expect(mepFor("2025-03", table)).toBe(1150);
    expect(mepFor("2026-08", table)).toBe(1300);
  });
  it("throws actionable errors naming the fetch script", () => {
    expect(() => mepFor("2025-01", {})).toThrow(/fetch-mep/);
    expect(() => mepFor("2024-01", table)).toThrow(/before 2024-01/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/mep.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mep'`.

- [ ] **Step 3: Implement**

`web/src/lib/cpi.ts` — replace the private `indexFor` with an exported, reusable lookup and point `toReal`/`latestMonth` at it:
```ts
// Shared by CPI and MEP: exact month, else nearest earlier month. `remedy` is the command
// the user must run, so an empty or short table produces an actionable error, not a NaN.
export function monthValue(month: string, table: Record<string, number>, remedy: string): number {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error(`table empty — run ${remedy}`);
  if (table[month] !== undefined) return table[month];
  const earlier = months.filter(m => m < month);
  if (earlier.length === 0) throw new Error(`No data at or before ${month} — run ${remedy}`);
  return table[earlier[earlier.length - 1]];
}

export const CPI_REMEDY = "npm run fetch-ipc";

export function toReal(amountArs: number, fromMonth: string, toMonth: string, table: CpiTable): number {
  return amountArs * (monthValue(toMonth, table, CPI_REMEDY) / monthValue(fromMonth, table, CPI_REMEDY));
}
```
(`latestMonth` and `loadCpi` are unchanged.)

`web/src/lib/mep.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
import { monthValue } from "@/lib/cpi";

export type MepTable = Record<string, number>; // "YYYY-MM" -> ARS per USD (monthly mean of MEP sell)

export function mepFor(month: string, table: MepTable): number {
  return monthValue(month, table, "npm run fetch-mep");
}

let _mep: MepTable | undefined;
export function loadMep(): MepTable {
  if (_mep) return _mep;
  const p = path.join(DATA_DIR, "mep.json");
  if (!fs.existsSync(p)) throw new Error("data/mep.json missing — run npm run fetch-mep");
  return (_mep = JSON.parse(fs.readFileSync(p, "utf8")) as MepTable);
}
```

`web/scripts/fetch-mep.ts`:
```ts
import fs from "node:fs";
import path from "node:path";

const URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa";

type Quote = { casa: string; compra: number | null; venta: number | null; fecha: string };

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`argentinadatos.com ${res.status} for ${URL}`);
  const rows = (await res.json()) as Quote[];
  // Monthly mean of the sell rate — every aggregate in this app is keyed by cycle month.
  const sums = new Map<string, { total: number; n: number }>();
  for (const q of rows) {
    if (q.venta == null || q.fecha < "2024-01-01") continue;
    const m = q.fecha.slice(0, 7);
    const acc = sums.get(m) ?? { total: 0, n: 0 };
    acc.total += q.venta; acc.n += 1;
    sums.set(m, acc);
  }
  if (sums.size === 0) throw new Error("empty MEP series — check the endpoint payload shape");
  const table: Record<string, number> = {};
  for (const [m, { total, n }] of [...sums].sort()) table[m] = Math.round((total / n) * 100) / 100;
  const out = path.resolve(process.cwd(), "..", "data", "mep.json");
  fs.writeFileSync(out, JSON.stringify(table, null, 1));
  console.log("wrote", out, Object.keys(table).length, "months, latest:", Object.keys(table).sort().at(-1));
}
main().catch(e => { console.error(e); process.exit(1); });
```

`web/package.json` — add to `scripts`:
```json
    "fetch-mep": "tsx scripts/fetch-mep.ts",
```

- [ ] **Step 4: Run tests, then fetch the real series**

Run: `cd web && npm test`
Expected: PASS (the shared `monthValue` must not break the existing CPI tests — `cpi.test.ts` asserts `/fetch-ipc/` on an empty table, which `CPI_REMEDY` preserves).

Run: `cd web && npm run fetch-mep`
Expected: `wrote .../data/mep.json 32 months, latest: 2026-08` (count grows with time).

Run: `node -e "const t=require('./data/mep.json'); console.log(t['2025-01'], t['2026-07'])"` from the repo root.
Expected: two plausible ARS-per-USD numbers, rising (~1150 then ~1500). Every cycle month in the DB (2025-01 … 2026-07) is inside this range, so `mepFor` cannot throw on real data.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/mep.ts web/src/lib/mep.test.ts web/src/lib/cpi.ts \
        web/scripts/fetch-mep.ts web/package.json data/mep.json
git commit -m "feat: MEP rate table sharing the CPI month lookup"
```

---

### Task 4: USD value mode + tax-inclusive mode

The riskiest change in the plan: it rewrites `effectiveAmount`, which every chart depends on. It also **deletes** the `{ ...modes, cpi: loadCpi() }` repetition from the pages and the three-prop `ModeToggle` call.

**Tax allocation** is pro-rata by design — `taxes_and_charges` rows are levied on the *statement*, not on individual purchases, and the source JSON carries no per-transaction link. Two corrections make it honest (folded-in findings 3 and 4):

- **`DEVOLUCION DE SALDOS` is excluded from the numerator.** It is a balance transfer, not a tax; its positive sign is arithmetically correct and must not be flipped. 11 rows, 2,406,357 ARS.
- **USD purchases converted at MEP join the denominator.** `DB.RG 5617 30%` is levied on foreign spend, which an ARS-only denominator cannot see.

Verified across all 27 statements: the worst multiplier falls from **×2.222 to ×1.221**, and the median statement lands near ×1.02.

**Files:**
- Modify: `web/src/lib/queries.ts`, `web/src/lib/queries.test.ts`, `web/src/lib/params.ts`, `web/src/lib/params.test.ts`, `web/src/lib/format.ts`, `web/src/lib/format.test.ts`, `web/src/components/ModeToggle.tsx`, `web/src/components/StackedArea.tsx`, `web/src/components/CompareBars.tsx`, `web/src/components/DrillBars.tsx`, `web/src/components/Sparkline.tsx`, `web/src/app/page.tsx`, `web/src/app/trends/page.tsx`, `web/src/app/categories/page.tsx`, `web/src/app/compare/page.tsx`

**Interfaces:**
- Consumes: `mepFor`/`MepTable` (T3), `toReal`/`latestMonth`/`CpiTable`.
- Produces:
  - `type ValueMode = "nominal" | "real" | "usd"`; `type TaxMode = "excl" | "incl"`
  - `type ValueOpts = { spend: SpendMode; value: ValueMode; tax: TaxMode; cpi: CpiTable; mep: MepTable }`
  - `type Modes = { spend: SpendMode; value: ValueMode; tax: TaxMode }`; `parseModes(sp): Modes`; `valueOpts(modes: Modes): ValueOpts` — both in `params.ts`
  - `toMode(amountArs: number, month: string, opts: ValueOpts, baseMonth: string): number` — exported from `queries.ts`; later tasks reuse it
  - `fmtMoney(n: number, value: ValueMode): string` — `format.ts`
  - `<ModeToggle modes={modes} baseMonth={…} spendToggle={false}? />`
- All existing query signatures are unchanged.

- [ ] **Step 1: Write the failing test**

`web/src/lib/queries.test.ts` — `ValueOpts` now needs two more fields, so the file's inline opts literals get a builder. Replace the fixture line (line 6) with:
```ts
import type { ValueMode, ValueOpts } from "@/lib/queries";
import type { SpendMode, TaxMode } from "@/lib/queries";

const cpi = { "2026-06": 100, "2026-07": 110 };
const mep = { "2026-06": 1000, "2026-07": 1100 };
const o = (spend: SpendMode, value: ValueMode, tax: TaxMode = "excl"): ValueOpts =>
  ({ spend, value, tax, cpi, mep });
```
Then rewrite the ten existing opts literals — mechanical, and it shrinks the file:

| Existing literal | Occurrences | Replacement |
|---|---|---|
| `{ spend: "accrual", value: "nominal", cpi }` | 1 (line 35) | `o("accrual", "nominal")` |
| `{ spend: "cash", value: "nominal", cpi }` | 5 (lines 41, 52, 55, 59, 84) | `o("cash", "nominal")` |
| `{ spend: "cash", value: "real", cpi }` | 4 (lines 47, 64, 77, 90) | `o("cash", "real")` |

Then append (the seed already carries a USD-only Spotify row and a June-only statement, so these need almost no extra fixture):
```ts
import { toMode } from "@/lib/queries";

const monthTotal = (rows: { month: string; amount: number }[], month: string) =>
  rows.filter(r => r.month === month).reduce((s, r) => s + r.amount, 0);

describe("USD value mode", () => {
  it("converts ARS rows at the month's MEP rate", () => {
    const db = openDb(":memory:");
    seed(db);
    const usd = monthTotal(monthlySpendByCategory(db, o("cash", "usd")), "2026-06");
    const nominal = monthTotal(monthlySpendByCategory(db, o("cash", "nominal")), "2026-06");
    expect(usd).toBeCloseTo(nominal / 1000, 6);
  });

  it("counts USD-billed rows at face value — the one place they enter aggregates", () => {
    const db = openDb(":memory:");
    seed(db);
    const subs = (mode: ValueMode) =>
      monthlySpendByCategory(db, o("cash", mode))
        .filter(r => r.month === "2026-07" && r.category === "subscriptions")
        .reduce((s, r) => s + r.amount, 0);
    expect(subs("usd")).toBeCloseTo(3.73, 6);   // the seeded Spotify row, billed in USD
    expect(subs("nominal")).toBe(0);            // rev note 3: never in ARS aggregates
  });
});

describe("tax-inclusive mode", () => {
  it("spreads a statement's taxes pro-rata across its purchases", () => {
    const db = openDb(":memory:");
    seed(db);
    // June holds one statement with a single 1000 ARS purchase; a 100 ARS tax row is +10%.
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'IVA RG 4240 21%', 'IVA RG 4240 21%', 'taxes_fees', NULL, 100, NULL, NULL, NULL)`
    ).run(sid);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1100, 6);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "excl")), "2026-06")).toBeCloseTo(1000, 6);
  });

  it("ignores DEVOLUCION DE SALDOS — a balance transfer, not a tax", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'DEVOLUCION DE SALDOS', 'DEVOLUCION DE SALDOS', 'taxes_fees', NULL, 5000, NULL, NULL, NULL)`
    ).run(sid);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1000, 6);
  });

  it("counts USD purchases in the denominator, since RG 5617 is levied on them", () => {
    const db = openDb(":memory:");
    seed(db);
    // July: 1400 ARS of purchases plus a USD-billed 3.73 (= 4103 ARS at the 1100 July rate).
    // A 551.5 ARS tax row is 10% of that 5515 combined base, not 39% of the 1400 ARS alone.
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'DB.RG 5617 30%', 'DB.RG 5617 30%', 'taxes_fees', NULL, ?, NULL, NULL, NULL)`
    ).run(sid, (900 + 3.73 * 1100) * 0.1);
    const excl = monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "excl")), "2026-07");
    const incl = monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-07");
    expect(incl / excl).toBeCloseTo(1.1, 3);
  });

  it("leaves statements with no tax rows alone", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = (tax: TaxMode) => monthTotal(monthlySpendByCategory(db, o("cash", "nominal", tax)), "2026-07");
    expect(jul("incl")).toBeCloseTo(jul("excl"), 6);
  });
});

describe("toMode", () => {
  it("passes nominal through, deflates real, divides usd", () => {
    expect(toMode(1000, "2026-06", o("cash", "nominal"), "2026-07")).toBe(1000);
    expect(toMode(1000, "2026-06", o("cash", "real"), "2026-07")).toBeCloseTo(1100);
    expect(toMode(1000, "2026-06", o("cash", "usd"), "2026-07")).toBeCloseTo(1);
  });
});
```

`web/src/lib/params.test.ts` — update the two existing assertions in place and add `valueOpts`' contract:
```ts
describe("parseModes", () => {
  it("defaults to accrual + real + pre-tax", () => {
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });
  it("reads valid params, rejects junk", () => {
    expect(parseModes({ spend: "cash", value: "nominal" }))
      .toEqual({ spend: "cash", value: "nominal", tax: "excl" });
    expect(parseModes({ spend: "bogus", value: "nominal" }))
      .toEqual({ spend: "accrual", value: "nominal", tax: "excl" });
    expect(parseModes({ value: "usd", tax: "incl" }))
      .toEqual({ spend: "accrual", value: "usd", tax: "incl" });
    expect(parseModes({ value: "bogus", tax: "bogus" }))
      .toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });
});
```
(the `withModes` describe block is unchanged — its two-key literals still satisfy `Record<string, string>`.)

Append to `web/src/lib/format.test.ts`:
```ts
import { fmtMoney } from "@/lib/format";

describe("fmtMoney", () => {
  it("formats pesos for nominal and real, dollars for usd", () => {
    expect(fmtMoney(1500, "nominal")).toBe(fmtArs(1500));
    expect(fmtMoney(1500, "real")).toBe(fmtArs(1500));
    expect(fmtMoney(3.73, "usd")).toBe("US$ 3.73");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/queries.test.ts src/lib/params.test.ts src/lib/format.test.ts`
Expected: FAIL — `toMode`/`fmtMoney` are not exported and `tax` is not a `ValueOpts` property.

- [ ] **Step 3: Implement**

`web/src/lib/queries.ts` — replace lines 1–51 (imports through `effectiveAmount`) with:
```ts
import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { mepFor, type MepTable } from "@/lib/mep";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";

export type SpendMode = "cash" | "accrual";
export type ValueMode = "nominal" | "real" | "usd";
export type TaxMode = "excl" | "incl";
export type ValueOpts = {
  spend: SpendMode; value: ValueMode; tax: TaxMode; cpi: CpiTable; mep: MepTable;
};

type BaseRow = {
  statement_id: number;
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

function baseRows(db: Database.Database): BaseRow[] {
  // Negatives net against spend, in BOTH currencies (rev note 2) — a USD refund must be able
  // to cancel its USD charge. USD rows ride along for drill/recurring (rev note 3).
  return db.prepare(`
    SELECT t.statement_id, s.cycle_month AS month, t.date, t.description, t.merchant,
           t.category, t.subcategory, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases'
      AND ((t.ars IS NOT NULL AND t.ars != 0) OR (t.ars IS NULL AND t.usd IS NOT NULL AND t.usd != 0))
    ORDER BY s.cycle_month, t.date
  `).all() as BaseRow[];
}

type AmountCtx = { baseMonth: string; minK: Map<string, number>; taxMult: Map<number, number> };

// Taxes are levied per statement, not per purchase — the JSON carries no link. Spread each
// statement's tax total across its purchases in proportion to amount (spec §3, "true cost").
// Two corrections keep this honest on real data:
//   - DEVOLUCION DE SALDOS is a balance transfer, not a tax. Its positive sign is arithmetically
//     correct (the statement reconciles with it), so exclude it rather than negating it.
//   - DB.RG 5617 is levied on FOREIGN spend, so USD purchases (at MEP) belong in the denominator.
// Without both, the worst real statement reaches x2.22; with them, x1.22.
function taxMultipliers(db: Database.Database, opts: ValueOpts): Map<number, number> {
  const mult = new Map<number, number>();
  if (opts.tax !== "incl") return mult;
  const rows = db.prepare(`
    SELECT t.statement_id, s.cycle_month AS month,
           SUM(CASE WHEN t.section = 'taxes_and_charges'
                     AND t.description NOT LIKE 'DEVOLUCION%' THEN t.ars ELSE 0 END) AS tax,
           SUM(CASE WHEN t.section = 'purchases' AND t.ars IS NOT NULL THEN t.ars ELSE 0 END) AS ars_purch,
           SUM(CASE WHEN t.section = 'purchases' AND t.ars IS NULL THEN COALESCE(t.usd, 0) ELSE 0 END) AS usd_purch
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    GROUP BY t.statement_id
  `).all() as { statement_id: number; month: string; tax: number; ars_purch: number; usd_purch: number }[];
  for (const r of rows) {
    const base = r.ars_purch + r.usd_purch * mepFor(r.month, opts.mep);
    if (base > 0) mult.set(r.statement_id, 1 + r.tax / base);
  }
  return mult;
}

function amountCtx(db: Database.Database, rows: BaseRow[], opts: ValueOpts): AmountCtx {
  const minK = new Map<string, number>();
  for (const r of rows) {
    if (r.installment_count == null || r.installment_number == null) continue;
    // merchant+count is NOT a series id — MERCADOLIBRE|6 covers six distinct purchases.
    const key = `${r.merchant}|${r.installment_count}|${r.date ?? ""}`;
    const cur = minK.get(key);
    if (cur === undefined || r.installment_number < cur) minK.set(key, r.installment_number);
  }
  return {
    baseMonth: opts.value === "real" ? latestMonth(opts.cpi) : "",
    minK,
    taxMult: taxMultipliers(db, opts),
  };
}

// Converts an ARS amount into the active value mode. Exported: projections and the
// currency split need it for figures that never pass through a BaseRow.
export function toMode(amountArs: number, month: string, opts: ValueOpts, baseMonth: string): number {
  if (opts.value === "real") return toReal(amountArs, month, baseMonth, opts.cpi);
  if (opts.value === "usd") return amountArs / mepFor(month, opts.mep);
  return amountArs;
}

// The single home of cash/accrual/real/usd/tax semantics. Returns null when the row
// doesn't contribute in this mode (USD-only outside usd mode, or a later cuota in accrual).
function effectiveAmount(r: BaseRow, opts: ValueOpts, ctx: AmountCtx): number | null {
  let cuotaFactor = 1;
  if (opts.spend === "accrual" && r.installment_count != null && r.installment_number != null) {
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}|${r.date ?? ""}`)!;
    if (r.installment_number !== k) return null;
    cuotaFactor = r.installment_count - k + 1; // remaining principal; full price when k=1 (rev note 4)
  }
  const mult = ctx.taxMult.get(r.statement_id) ?? 1;
  if (r.ars == null) {
    // USD-billed row: only usd mode can value it, and its own USD figure is the truth.
    return opts.value === "usd" && r.usd != null ? r.usd * cuotaFactor * mult : null;
  }
  return toMode(r.ars * cuotaFactor * mult, r.month, opts, ctx.baseMonth);
}
```

Then update the three `amountCtx(...)` call sites in the rest of the file (`monthlySpendByCategory`, `categoryDrill`, `periodComparison`) from `amountCtx(rows, opts)` / `amountCtx(all, opts)` to `amountCtx(db, rows, opts)` / `amountCtx(db, all, opts)`.

`web/src/lib/params.ts` — absorb `valueOpts` here rather than adding a file for it. **Constraint: `params.ts` must never be imported by a `"use client"` component**, because `loadCpi`/`loadMep` read the filesystem. Today only server pages import it; keep it that way.
```ts
import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import type { SpendMode, TaxMode, ValueMode, ValueOpts } from "@/lib/queries";

type SP = { [k: string]: string | string[] | undefined };

export type Modes = { spend: SpendMode; value: ValueMode; tax: TaxMode };

export function parseModes(sp: SP): Modes {
  const spend: SpendMode = sp.spend === "cash" ? "cash" : "accrual";
  const value: ValueMode = sp.value === "nominal" ? "nominal" : sp.value === "usd" ? "usd" : "real";
  const tax: TaxMode = sp.tax === "incl" ? "incl" : "excl";
  return { spend, value, tax };
}

// Server-only: the single place a page assembles ValueOpts. Both tables are module-cached.
export function valueOpts(modes: Modes): ValueOpts {
  return { ...modes, cpi: loadCpi(), mep: loadMep() };
}

export function withModes(
  path: string,
  modes: Record<string, string>,
  extra: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ ...modes, ...extra });
  return `${path}?${q.toString()}`;
}
```

`web/src/lib/format.ts` — add the mode-aware formatter:
```ts
import type { ValueMode } from "@/lib/queries";

export function fmtMoney(n: number, value: ValueMode): string {
  return value === "usd" ? `US$ ${n.toFixed(2)}` : fmtArs(n);
}
```

`web/src/components/ModeToggle.tsx` — take the whole `modes` object, add the USD option and the tax toggle, and allow a page to hide the spend segment when it does not honour it:
```tsx
export function ModeToggle({ modes, baseMonth, spendToggle = true }: {
  modes: { spend: string; value: string; tax: string };
  baseMonth?: string;
  spendToggle?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {modes.value === "real" && baseMonth && (
        <span className="text-xs text-zinc-500">in {baseMonth} pesos</span>
      )}
      {modes.value === "usd" && <span className="text-xs text-zinc-500">at MEP</span>}
      <Seg param="value" current={modes.value}
        options={[["real", "Real $"], ["nominal", "Nominal $"], ["usd", "USD"]]} />
      {spendToggle && (
        <Seg param="spend" current={modes.spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
      )}
      <Seg param="tax" current={modes.tax} options={[["excl", "Pre-tax"], ["incl", "True cost"]]} />
    </div>
  );
}
```

The three Phase 1 charts hardcode `fmtArs` and would print `$ 4` for `US$ 3.73`. Give each a `value` prop:

`web/src/components/StackedArea.tsx`:
```tsx
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function StackedArea({ data, categories, value }: {
  data: Record<string, number | string>[]; categories: Category[]; value: ValueMode;
}) {
```
and replace both `fmtArs(...)` uses with `fmtMoney(v, value)` / `fmtMoney(Number(v), value)`.

`web/src/components/CompareBars.tsx` — add `value: ValueMode` to the props and swap `fmtArs` for `fmtMoney(..., value)` in the `YAxis` `tickFormatter` and the `Tooltip` `formatter` (the `LabelList` keeps `fmtPct`).

`web/src/components/DrillBars.tsx` — add `value: ValueMode` to the props and swap both `fmtArs` uses for `fmtMoney(..., value)`.

`web/src/components/Sparkline.tsx` — unchanged (it renders no labels).

Pages — apply to `web/src/app/page.tsx`, `trends/page.tsx`, `categories/page.tsx`, `compare/page.tsx`:
1. import `valueOpts` from `@/lib/params` (alongside `parseModes`/`withModes`) and `fmtMoney` from `@/lib/format`;
2. build the opts once: `const opts = valueOpts(modes);` and pass `opts` to the query instead of `{ ...modes, cpi }`;
3. derive the caption from those opts — `baseMonth={latestMonth(opts.cpi)}` — and **delete the page's `loadCpi`/`const cpi = loadCpi()` lines**, keeping only the `latestMonth` import;
4. replace `<ModeToggle spend={modes.spend} value={modes.value} … />` with `<ModeToggle modes={modes} baseMonth={…} />`;
5. pass `value={modes.value}` to `StackedArea` / `CompareBars` / `DrillBars`;
6. replace every `fmtArs(x)` with `fmtMoney(x, modes.value)`.

In `page.tsx` also fix the label so USD reads correctly:
```tsx
  const valueLabel = modes.value === "real" ? "real" : modes.value === "usd" ? "USD" : "nominal";
```
`web/src/app/page.tsx` keeps `baseMonth={t.baseMonth}` (eli5 already returns it) and therefore needs no `latestMonth` import.

`web/src/app/recurring/page.tsx` is deliberately untouched — it is nominal-only by design (folded-in finding 10).

`web/src/components/Nav.tsx` — the link row grows in later tasks; make it wrap now:
```tsx
    <nav className="flex flex-wrap gap-4 py-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
```

- [ ] **Step 4: Run the full suite and build**

Run: `cd web && npm test`
Expected: PASS.

Run: `cd web && npm run build`
Expected: build succeeds (catches every missed `ModeToggle`/`valueOpts`/`value` call site).

- [ ] **Step 5: Verify against real data**

Sanity-check the tax multipliers before trusting the toggle. From the repo root:

```bash
sqlite3 data/app.db "SELECT s.file, ROUND(1 + SUM(CASE WHEN t.section='taxes_and_charges' AND t.description NOT LIKE 'DEVOLUCION%' THEN t.ars ELSE 0 END) / NULLIF(SUM(CASE WHEN t.section='purchases' AND t.ars IS NOT NULL THEN t.ars ELSE 0 END), 0), 3) mult_ars_only FROM transactions t JOIN statements s ON s.id=t.statement_id GROUP BY s.id ORDER BY mult_ars_only DESC LIMIT 3;"
```
Expected: the top value is ~1.83 (`visa_2025_06_26`) — that is the ARS-only denominator, i.e. what the app must **not** do. In the running app the same statement must show a much smaller uplift, because USD purchases join the base.

Then open `/trends`. Switch value to **USD**: the stacked area re-scales to roughly 1/1500 of nominal, axis labels read `US$ …`, and the subscriptions band grows relative to nominal (Spotify/Apple USD rows now count). Switch tax to **True cost**: every month rises, and no month more than about 25%. If any month roughly doubles, the `DEVOLUCION` exclusion or the USD denominator is missing. Navigate to `/categories`: the mode selection must survive.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts web/src/lib/params.ts \
        web/src/lib/params.test.ts web/src/lib/format.ts web/src/lib/format.test.ts \
        web/src/components web/src/app/page.tsx web/src/app/trends/page.tsx \
        web/src/app/categories/page.tsx web/src/app/compare/page.tsx
git commit -m "feat: USD (MEP) value mode and tax-inclusive true-cost mode"
```

---

### Task 5: Dual-currency split page (chart 9)

**Files:**
- Create: `web/src/app/currency/page.tsx`, `web/src/components/CurrencyBars.tsx`
- Modify: `web/src/lib/queries.ts`, `web/src/lib/queries.test.ts`, `web/src/components/Nav.tsx`

**Interfaces:**
- Consumes: `toMode`, `ValueOpts`, `baseRows` (T4).
- Produces: `currencySplit(db, opts): { month: string; arsBilled: number; usdBilled: number }[]` — both series in the active value mode. USD-billed rows are converted through that month's MEP so the two are comparable *on this chart only*; that is the whole point of chart 9 and does not weaken rev note 3 elsewhere.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/queries.test.ts`:
```ts
import { currencySplit } from "@/lib/queries";

describe("currencySplit", () => {
  it("separates ARS-billed from USD-billed spend, both in the active mode", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = currencySplit(db, o("cash", "usd")).find(r => r.month === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73, 6);  // the seeded Spotify row
    expect(jul.arsBilled).toBeGreaterThan(0);
  });
  it("reports USD-billed spend in pesos when the mode is nominal", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = currencySplit(db, o("cash", "nominal")).find(r => r.month === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73 * 1100, 6);
    expect(jul.arsBilled).toBeCloseTo(1400, 6);  // 1000 - 200 + 100 + 500
  });
  it("leaves months without USD-billed rows at zero", () => {
    const db = openDb(":memory:");
    seed(db);
    expect(currencySplit(db, o("cash", "nominal")).find(r => r.month === "2026-06")!.usdBilled).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `currencySplit` is not exported.

- [ ] **Step 3: Implement**

Append to `web/src/lib/queries.ts`:
```ts
// Chart 9. Both series land in the active value mode: ARS-billed rows through the normal
// path, USD-billed rows converted at their month's MEP so the split is readable side by side.
export function currencySplit(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, { arsBilled: number; usdBilled: number }>();
  for (const r of rows) {
    const bucket = acc.get(r.month) ?? { arsBilled: 0, usdBilled: 0 };
    if (r.ars != null) {
      const amt = effectiveAmount(r, opts, ctx);
      if (amt != null) bucket.arsBilled += amt;
    } else if (r.usd != null) {
      const mult = ctx.taxMult.get(r.statement_id) ?? 1;
      bucket.usdBilled += opts.value === "usd"
        ? r.usd * mult
        : toMode(r.usd * mult * mepFor(r.month, opts.mep), r.month, opts, ctx.baseMonth);
    }
    acc.set(r.month, bucket);
  }
  return [...acc.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
```

`web/src/components/CurrencyBars.tsx`:
```tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function CurrencyBars({ data, value }: {
  data: { month: string; arsBilled: number; usdBilled: number }[];
  value: ValueMode;
}) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Legend />
        <Bar dataKey="arsBilled" name="ARS-billed" stackId="1" fill="#0ea5e9" />
        <Bar dataKey="usdBilled" name="USD-billed" stackId="1" fill="#8b5cf6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/currency/page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { currencySplit } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CurrencyBars } from "@/components/CurrencyBars";

export const dynamic = "force-dynamic";

export default async function Currency({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = currencySplit(getDb(), opts);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">ARS vs USD spending</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <CurrencyBars data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        USD-billed purchases are converted at each cycle month&apos;s average MEP rate so both bars
        share one unit. Foreign spending is lumpy — a travel month can dominate the year.
      </p>
    </main>
  );
}
```

`web/src/components/Nav.tsx` — add to `links`, after `["/trends", "Trends"]`:
```tsx
  ["/currency", "Currency"],
```

- [ ] **Step 4: Run tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/currency`. USD-billed purchases are **~22% of total spend** across the window (162 rows, ~US$9,400) and are dominated by travel, not subscriptions: expect a very large USD segment in **2025-06** (`APPLE COM/US` US$3,262) and **2025-07** (`NATIONAL CAR RENTAL` US$1,304, hotels), a moderate one in 2026-01 and 2026-03, and a thin sliver elsewhere. A uniformly tiny USD band across all months means USD rows are not being picked up.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts web/src/components/CurrencyBars.tsx \
        web/src/app/currency web/src/components/Nav.tsx
git commit -m "feat: dual-currency split chart"
```

---

### Task 6: Anomaly engine (`anomalies.ts`) + timeline page (chart 10)

Spec §3 "suspicious charges" — territory the research found unoccupied across ~25 products. Every constant below was measured against this database:

- **Cuota rows are excluded from duplicate detection.** A cuota purchase is re-listed in *every* statement carrying the **original purchase date**: `TIENDANEWSAN` appears 13 times, all dated `2025-07-17`, all `166,666.61`.
- **Duplicates must be same-statement.** Cross-card matching flags two real HOYTS cinema purchases bought on both cards the same day (statements 32 and 48). Constrained to one statement, the real DB yields exactly 3 hits.
- **A 10,000 ARS floor** removes the `PEDIDOSYA PROPINA` tip noise (13 pairs of identical 350–1,500 charges). The smallest surviving hit is 57,613.
- **All three real duplicates carry an exact offsetting reversal** on the same statement — the bank already fixed them. Reporting them as open alarms would make the newest statement look broken.
- **Amount jumps need a one-charge-per-month gate.** Ungated, 42 alerts fire and most measure *volume* (COTO, YPF, tolls, tips), not price. Gated to merchants billed exactly once in both compared months at >25% real, **6 alerts** fire across 19 months.
- **Jumps are measured in real terms.** In ARS everything rises monthly; deflating first means the flag fires only when a price rose *faster than inflation*.

**Files:**
- Create: `web/src/lib/anomalies.ts`, `web/src/app/anomalies/page.tsx`, `web/src/components/AnomalyTimeline.tsx`
- Test: `web/src/lib/anomalies.test.ts`
- Modify: `web/src/lib/queries.ts`, `web/src/components/Nav.tsx`

**Interfaces:**
- Consumes: `detectRecurring` (T2, now netting), `toReal`/`CpiTable`.
- Produces:
  - `type Anomaly = { kind: "duplicate" | "amount_jump" | "new_merchant"; merchant: string; month: string; date: string | null; amount: number; message: string; resolved: boolean }`
  - `type AnomalyRow` — a structural subset of `BaseRow`, so `detectAnomalies(baseRows(db), cpi)` typechecks with no mapping
  - `detectAnomalies(rows: AnomalyRow[], cpi: CpiTable): Anomaly[]`
  - `anomalies(db, cpi): Anomaly[]` and `monthlyTotals(db, opts): { month: string; amount: number }[]` — `queries.ts`; `eli5` is refactored onto `monthlyTotals`, deleting its duplicate reduction

- [ ] **Step 1: Write the failing test**

`web/src/lib/anomalies.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectAnomalies } from "@/lib/anomalies";

const cpi = { "2026-01": 100, "2026-02": 105, "2026-03": 110, "2026-04": 115 };

type RowOpts = Partial<{
  statement_id: number; merchant: string; month: string; date: string;
  ars: number | null; usd: number | null; installment_count: number | null;
}>;

// date defaults to the 10th of the row's own month so month and date never disagree.
const row = (o: RowOpts = {}) => {
  const month = o.month ?? "2026-04";
  return {
    statement_id: o.statement_id ?? 1,
    merchant: o.merchant ?? "X",
    month,
    date: o.date ?? `${month}-10`,
    ars: o.ars === undefined ? 50000 : o.ars,
    usd: o.usd ?? null,
    installment_count: o.installment_count ?? null,
  };
};

const only = (kind: string, rows: ReturnType<typeof row>[]) =>
  detectAnomalies(rows, cpi).filter(a => a.kind === kind);

describe("duplicate detection", () => {
  it("flags same merchant + amount within 2 days on one statement", () => {
    const out = only("duplicate", [
      row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }),
      row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "OSDE", resolved: false, amount: 273395.99 });
  });

  it("marks a duplicate resolved when the statement carries an exact reversal", () => {
    const out = only("duplicate", [
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: 57613.51 }),
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: 57613.51 }),
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: -57613.51 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].resolved).toBe(true);
    expect(out[0].message).toMatch(/reversed/);
  });

  it("never pairs rows from different statements — two cards, one cinema trip", () => {
    expect(only("duplicate", [
      row({ statement_id: 32, merchant: "HOYTS", date: "2026-04-15", ars: 32800 }),
      row({ statement_id: 48, merchant: "HOYTS", date: "2026-04-15", ars: 32800 }),
    ])).toHaveLength(0);
  });

  it("never flags cuota rows — the same purchase is re-listed every statement", () => {
    expect(only("duplicate", ["2026-01", "2026-02", "2026-03", "2026-04"].map(month =>
      row({ merchant: "TIENDANEWSAN", month, date: "2025-07-17", ars: 166666.61, installment_count: 18 })
    ))).toHaveLength(0);
  });

  it("ignores small repeats below the amount floor (PedidosYa tips)", () => {
    expect(only("duplicate", [
      row({ merchant: "PEDIDOSYA PROPINA", date: "2026-04-10", ars: 550 }),
      row({ merchant: "PEDIDOSYA PROPINA", date: "2026-04-11", ars: 550 }),
    ])).toHaveLength(0);
  });

  it("ignores identical charges more than 2 days apart", () => {
    expect(only("duplicate", [
      row({ merchant: "OSDE", date: "2026-04-01", ars: 273395.99 }),
      row({ merchant: "OSDE", date: "2026-04-10", ars: 273395.99 }),
    ])).toHaveLength(0);
  });

  it("pairs each row at most once — three identical charges report one pair", () => {
    expect(only("duplicate",
      [1, 2, 3].map(() => row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }))
    )).toHaveLength(1);
  });
});

describe("amount-jump detection", () => {
  const monthly = (month: string, ars: number) => row({ merchant: "OSDE", month, date: `${month}-05`, ars });

  it("stays silent when a recurring charge merely tracks inflation", () => {
    // +5%/month nominal against +5%/month CPI = flat in real terms.
    expect(only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 105000),
      monthly("2026-03", 110000), monthly("2026-04", 115000),
    ])).toHaveLength(0);
  });

  it("flags a real-terms price hike on a recurring merchant", () => {
    const out = only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 105000),
      monthly("2026-03", 110000), monthly("2026-04", 180000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "OSDE", month: "2026-04" });
    expect(out[0].message).toMatch(/real terms/);
  });

  it("ignores merchants billed many times a month — that is volume, not price", () => {
    // A supermarket: 1 visit in March, 4 in April. The monthly total quadruples; the price did not.
    expect(only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 100000), monthly("2026-03", 100000),
      monthly("2026-04", 100000), monthly("2026-04", 100000),
      monthly("2026-04", 100000), monthly("2026-04", 100000),
    ])).toHaveLength(0);
  });

  it("never flags a non-recurring merchant, however wild the amounts", () => {
    expect(only("amount_jump", [
      row({ merchant: "ONE OFF", month: "2026-01", ars: 1000 }),
      row({ merchant: "ONE OFF", month: "2026-04", ars: 900000 }),
    ])).toHaveLength(0);
  });
});

describe("new-merchant detection", () => {
  it("flags merchants first seen in the latest month, above the floor, once each", () => {
    const out = only("new_merchant", [
      row({ merchant: "OSDE", month: "2026-01", ars: 100000 }),
      row({ merchant: "OSDE", month: "2026-04", ars: 100000 }),
      row({ merchant: "SOCIAL CORAZON", month: "2026-04", ars: 60000 }),
      row({ merchant: "SOCIAL CORAZON", month: "2026-04", ars: 55700 }),
      row({ merchant: "TINY", month: "2026-04", ars: 300 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "SOCIAL CORAZON", amount: 115700 });
  });

  it("returns nothing at all on an empty history", () => {
    expect(detectAnomalies([], cpi)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/anomalies.test.ts`
Expected: FAIL — `Cannot find module '@/lib/anomalies'`.

- [ ] **Step 3: Implement**

`web/src/lib/anomalies.ts`:
```ts
import { toReal, type CpiTable } from "@/lib/cpi";
import { detectRecurring } from "@/lib/recurring";

// Structural subset of queries.ts' BaseRow, so baseRows(db) passes straight in.
export type AnomalyRow = {
  statement_id: number;
  merchant: string;
  month: string;
  date: string | null;
  ars: number | null;
  usd: number | null;
  installment_count: number | null;
};

export type Anomaly = {
  kind: "duplicate" | "amount_jump" | "new_merchant";
  merchant: string;
  month: string;
  date: string | null;
  amount: number;
  message: string;
  resolved: boolean;
};

// Tuned to this dataset, not knobs — see the task header for what each one removes.
const MIN_AMOUNT = 10_000;  // kills the PedidosYa tip pairs; smallest real hit is 57,613
const DAY_WINDOW = 2;       // Actual Budget's schedule-matching window
const JUMP_PCT = 25;        // real terms, i.e. above and beyond inflation

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000;
}

// Cuota rows repeat across statements carrying the ORIGINAL purchase date and amount
// (TIENDANEWSAN: 13 rows, all 2025-07-17, all 166666.61) — never duplicates. And a pair must
// sit on ONE statement: the same purchase split across two cards is two real transactions.
function duplicates(rows: AnomalyRow[]): Anomaly[] {
  const candidates = rows.filter(
    r => r.installment_count == null && r.ars != null && r.ars >= MIN_AMOUNT && r.date != null
  );
  const reversals = new Set(
    rows.filter(r => r.ars != null && r.ars < 0).map(r => `${r.statement_id}|${r.merchant}|${-r.ars!}`)
  );
  const out: Anomaly[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (paired.has(j)) continue;
      const a = candidates[i], b = candidates[j];
      if (a.statement_id !== b.statement_id) continue;
      if (a.merchant !== b.merchant || a.ars !== b.ars) continue;
      if (daysApart(a.date!, b.date!) > DAY_WINDOW) continue;
      paired.add(j);
      const resolved = reversals.has(`${b.statement_id}|${b.merchant}|${b.ars}`);
      out.push({
        kind: "duplicate", merchant: a.merchant, month: b.month, date: b.date,
        amount: a.ars!, resolved,
        message: resolved
          ? `charged twice on ${b.date} — already reversed on the same statement`
          : `charged twice within ${DAY_WINDOW} days (${a.date} and ${b.date})`,
      });
      break;
    }
  }
  return out;
}

// In ARS everything rises monthly, so deflate first: the flag means "rose faster than inflation".
// And only compare months where the merchant billed exactly once — otherwise a supermarket's
// visit count reads as a price hike (ungated this fires 42 times on real data; gated, 6).
function amountJumps(rows: AnomalyRow[], cpi: CpiTable): Anomaly[] {
  const recurring = new Set(
    detectRecurring(rows).filter(r => r.currency === "ARS").map(r => r.merchant)
  );
  const totals = new Map<string, Map<string, number>>();
  const charges = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!recurring.has(r.merchant) || r.ars == null || r.installment_count != null) continue;
    const t = totals.get(r.merchant) ?? new Map<string, number>();
    const c = charges.get(r.merchant) ?? new Map<string, number>();
    t.set(r.month, (t.get(r.month) ?? 0) + r.ars);
    c.set(r.month, (c.get(r.month) ?? 0) + 1);
    totals.set(r.merchant, t); charges.set(r.merchant, c);
  }
  const base = Object.keys(cpi).sort().at(-1)!;
  const out: Anomaly[] = [];
  for (const [merchant, months] of totals) {
    const sorted = [...months.keys()].filter(m => months.get(m)! > 0).sort();
    const c = charges.get(merchant)!;
    for (let i = 1; i < sorted.length; i++) {
      const [pm, cm] = [sorted[i - 1], sorted[i]];
      if (c.get(pm) !== 1 || c.get(cm) !== 1) continue;
      const prev = toReal(months.get(pm)!, pm, base, cpi);
      const cur = toReal(months.get(cm)!, cm, base, cpi);
      const pct = ((cur - prev) / prev) * 100;
      if (pct <= JUMP_PCT) continue;
      out.push({
        kind: "amount_jump", merchant, month: cm, date: null,
        amount: months.get(cm)!, resolved: false,
        message: `up ${pct.toFixed(1)}% in real terms vs ${pm}`,
      });
    }
  }
  return out;
}

function newMerchants(rows: AnomalyRow[]): Anomaly[] {
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latest = months.at(-1);
  if (!latest) return [];
  const firstSeen = new Map<string, string>();
  for (const r of rows) {
    const cur = firstSeen.get(r.merchant);
    if (cur === undefined || r.month < cur) firstSeen.set(r.merchant, r.month);
  }
  const totals = new Map<string, number>(); // one alert per merchant, not per charge
  for (const r of rows) {
    if (r.month !== latest || firstSeen.get(r.merchant) !== latest || r.ars == null) continue;
    totals.set(r.merchant, (totals.get(r.merchant) ?? 0) + r.ars);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount >= MIN_AMOUNT)
    .map(([merchant, amount]) => ({
      kind: "new_merchant" as const, merchant, month: latest, date: null,
      amount, resolved: false,
      message: `first charge from this merchant in ${months.length} months of statements`,
    }));
}

export function detectAnomalies(rows: AnomalyRow[], cpi: CpiTable): Anomaly[] {
  if (rows.length === 0) return [];
  return [...duplicates(rows), ...amountJumps(rows, cpi), ...newMerchants(rows)]
    .sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount);
}
```

Append to `web/src/lib/queries.ts`:
```ts
import { detectAnomalies, type Anomaly } from "@/lib/anomalies";

// Computed per query, never persisted: anomalies depend on the whole history and on CPI,
// so a stored copy would go stale the moment a statement or the CPI table changes.
export function anomalies(db: Database.Database, cpi: CpiTable): Anomaly[] {
  return detectAnomalies(baseRows(db), cpi);
}

export function monthlyTotals(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt != null) acc.set(r.month, (acc.get(r.month) ?? 0) + amt);
  }
  return [...acc.entries()].map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
```
and refactor `eli5` onto it — replace its opening three statements (the `monthlySpendByCategory` call plus the `byMonth`/`sorted` reduction) with:
```ts
  const months = monthlySpendByCategory(db, opts);
  const sorted = monthlyTotals(db, opts).map(m => [m.month, m.amount] as [string, number]);
  if (sorted.length === 0) throw new Error("No statements ingested — run npm run ingest");
```
(the `const [lastMonthKey, spentThisMonth] = sorted[sorted.length - 1];` line and everything after it are unchanged; `months` is still used for `topCategories`.)

`web/src/components/AnomalyTimeline.tsx`:
```tsx
"use client";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function AnomalyTimeline({ totals, flaggedMonths, value }: {
  totals: { month: string; amount: number }[];
  flaggedMonths: string[];
  value: ValueMode;
}) {
  const flagged = new Set(flaggedMonths);
  const data = totals.map(t => ({
    month: t.month,
    amount: t.amount,
    flag: flagged.has(t.month) ? t.amount : undefined,
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Line type="monotone" dataKey="amount" stroke="#0ea5e9" strokeWidth={2} dot={false} />
        <Scatter dataKey="flag" fill="#ef4444" shape="circle" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/anomalies/page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { anomalies, monthlyTotals } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { AnomalyTimeline } from "@/components/AnomalyTimeline";

export const dynamic = "force-dynamic";

const KIND_LABEL = {
  duplicate: "Duplicate", amount_jump: "Price jump", new_merchant: "New merchant",
} as const;

export default async function Anomalies({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const db = getDb();
  const opts = valueOpts(modes);
  const found = anomalies(db, opts.cpi);
  const totals = monthlyTotals(db, opts);
  const flaggedMonths = found.filter(a => !a.resolved).map(a => a.month);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Anomalies</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <AnomalyTimeline totals={totals} flaggedMonths={flaggedMonths} value={modes.value} />
      <table className="w-full text-sm mt-6">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">When</th><th>Kind</th><th>Merchant</th>
          <th className="text-right">Amount</th><th>What happened</th>
        </tr></thead>
        <tbody>
          {found.map((a, i) => (
            <tr key={i} className={`border-t border-zinc-100 dark:border-zinc-800 ${a.resolved ? "text-zinc-400" : ""}`}>
              <td className="py-1 whitespace-nowrap">{a.date ?? a.month}</td>
              <td>{KIND_LABEL[a.kind]}</td>
              <td>{a.merchant}</td>
              <td className="text-right">{fmtArs(a.amount)}</td>
              <td>{a.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-zinc-500 mt-3">
        Amounts in this table are always the nominal pesos the card billed — that is what you would
        dispute. Greyed rows already resolved themselves on the statement. Price jumps are measured
        in real terms, and only for merchants billed exactly once a month, so a busier month at the
        supermarket is not mistaken for a price rise. Duplicate matching uses the ±2-day window
        Actual Budget uses for schedules, stays within one statement, and ignores installment rows,
        which every statement re-lists at their original purchase date.
      </p>
    </main>
  );
}
```

`web/src/components/Nav.tsx` — add after `["/recurring", "Recurring"]`:
```tsx
  ["/anomalies", "Anomalies"],
```

- [ ] **Step 4: Run tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/anomalies`. Expect **exactly 13 rows**:
- **3 duplicates**, all in 2026-07 and all **greyed as resolved**: `OSDE` 273,395.99, `SANCOR` 233,665.66, `PERSONAL` 57,613.51.
- **6 price jumps**: 2025-02 `HBO MAX` +29%, 2025-04 `ADOBE` +630%, 2025-05 `GOOGLE YOUTUBE PREMIUM` +76%, 2025-10 `PERSONAL` +34%, 2026-06 `AUTOPISTAS URBAN` +152%, 2026-06 `COTO` +666%.
- **4 new merchants** in 2026-07: `SOCIAL CORAZON` 115,700, `NALDO COM AR` 78,333, `AMENYDBLANCO` 43,000, `CAFE MALECON-CAFE MALECO` 30,500.

No `PEDIDOSYA PROPINA`, no `TIENDANEWSAN`/`ELECTRONICAFLA`/`BATUKHUOKY` cuota rows, no `HOYTS`, and no `CARREFOUR` in new merchants (Task 1 fixed that). If you see ~42 price jumps, the one-charge-per-month gate is missing; if you see 5 duplicates including HOYTS, the same-statement constraint is missing. Red scatter dots appear only on months with unresolved anomalies — so **not** on 2026-07.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/anomalies.ts web/src/lib/anomalies.test.ts web/src/lib/queries.ts \
        web/src/components/AnomalyTimeline.tsx web/src/app/anomalies web/src/components/Nav.tsx
git commit -m "feat: anomaly engine with duplicate, real-terms jump and new-merchant detection"
```

---

### Task 7: Cuota waterfall with 3 projection layers (`projection.ts`) — chart 4

Spec §5. The differentiator nobody ships (research: "Simplifi projects 12 months but as a single line").

Three real-data traps:

1. **Never sum `upcoming_installments` across statements.** Visa's 2026-07-02 statement lists 2026-08 = 296,957.14; its 2026-07-30 successor lists 2026-08 = 375,290.39. Only the newest statement per brand counts (rev note 7).
2. **Inflation applies per value mode, or the layers lie.** `upcoming_installments` are contractual *nominal* future pesos. In `nominal` mode the recurring and variable layers grow; in `real` mode the contractual cuotas are **deflated** instead, because holding a nominal cuota constant while everything else is in constant pesos overstates it. Only the certain layer is ever deflated — recurring and variable are assumed to track inflation, so in constant pesos they are flat.
3. **Recurring needs a recency gate.** `detectRecurring` has none, so a subscription cancelled in 2025 gets projected into 2027 (~87,000 ARS/month of dead merchants, including two whose billing simply moved to USD).

**Files:**
- Create: `web/src/lib/projection.ts`, `web/src/app/future/page.tsx`, `web/src/components/ProjectionChart.tsx`
- Test: `web/src/lib/projection.test.ts`
- Modify: `web/src/lib/cpi.ts`, `web/src/lib/cpi.test.ts`, `web/src/lib/queries.ts`, `web/src/lib/queries.test.ts`, `web/src/components/Nav.tsx`

**Interfaces:**
- Consumes: `addMonth` (T1), `toMode` (T4), `detectRecurring`, `latestMonth`, `monthsBetween`.
- Produces:
  - `trailingMonthlyInflation(table: CpiTable, n?: number): number` — `cpi.ts`
  - `type ProjectionMonth = { month: string; certain: number; expected: number; estLow: number; estHigh: number }`
  - `project(input): ProjectionMonth[]` — `projection.ts`
  - `latestStatementIds(db): number[]` — `queries.ts` (extracted from `eli5`, which now calls it)
  - `cuotaProjection(db, opts, horizon?): ProjectionMonth[]` — `queries.ts`, default horizon 6

- [ ] **Step 1: Write the failing test**

`web/src/lib/projection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { project } from "@/lib/projection";

const base = {
  startMonth: "2026-08",
  horizon: 3,
  upcoming: [
    { month: "2026-08", amount: 400000 },
    { month: "2026-09", amount: 300000 },
  ],
  recurringMonthly: 100000,
  variableHistory: [80000, 100000, 120000],
  inflation: 0.02,
  mode: "nominal" as const,
};

describe("project", () => {
  it("emits one row per horizon month starting at startMonth", () => {
    expect(project(base).map(p => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("takes the certain layer straight from the contractual schedule, zero past its end", () => {
    const p = project(base);
    expect(p[0].certain).toBe(400000);
    expect(p[1].certain).toBe(300000);
    expect(p[2].certain).toBe(0);
  });

  it("grows the expected and estimated layers with inflation in nominal mode", () => {
    const p = project(base);
    expect(p[0].expected).toBeCloseTo(100000 * 1.02);
    expect(p[2].expected).toBeCloseTo(100000 * 1.02 ** 3);
    expect(p[0].estLow).toBeCloseTo(80000 * 1.02);
    expect(p[0].estHigh).toBeCloseTo(120000 * 1.02);
  });

  it("holds expected flat and deflates only the contractual layer in real mode", () => {
    const p = project({ ...base, mode: "real" });
    expect(p[2].expected).toBeCloseTo(100000);
    expect(p[2].estHigh).toBeCloseTo(120000);
    expect(p[0].certain).toBeCloseTo(400000 / 1.02);
    expect(p[1].certain).toBeCloseTo(300000 / 1.02 ** 2);
  });

  it("neither grows nor deflates in usd mode", () => {
    const p = project({ ...base, mode: "usd" });
    expect(p[0].certain).toBe(400000);
    expect(p[0].expected).toBe(100000);
  });

  it("zeroes the estimated band when there is no variable history", () => {
    const p = project({ ...base, variableHistory: [] });
    expect(p[0].estLow).toBe(0);
    expect(p[0].estHigh).toBe(0);
  });
});
```

Append to `web/src/lib/queries.test.ts` — the regression test for trap 1, the one that would silently inflate every forecast:
```ts
import { cuotaProjection, latestStatementIds } from "@/lib/queries";

describe("cuotaProjection", () => {
  it("takes the certain layer only from the newest statement per brand", () => {
    const db = openDb(":memory:");
    seed(db);
    // The June Visa statement is superseded by the July one. Its schedule must not be added.
    const june = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-08', 9999)").run(june);

    expect(latestStatementIds(db)).toHaveLength(2); // one visa, one mastercard
    const p = cuotaProjection(db, o("cash", "nominal"), 3);
    expect(p.map(x => x.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(p[0].certain).toBeCloseTo(250, 6); // 200 (visa July) + 50 (mastercard), never 10249
    expect(p[1].certain).toBeCloseTo(100, 6);
    expect(p[2].certain).toBe(0);
  });

  it("returns nothing when no statements are ingested", () => {
    expect(cuotaProjection(openDb(":memory:"), o("cash", "nominal"))).toEqual([]);
  });
});
```

Append to `web/src/lib/cpi.test.ts`:
```ts
import { trailingMonthlyInflation } from "@/lib/cpi";

describe("trailingMonthlyInflation", () => {
  it("returns the geometric mean monthly rate over the trailing window", () => {
    const t = { "2026-01": 100, "2026-02": 110, "2026-03": 121 };
    expect(trailingMonthlyInflation(t, 6)).toBeCloseTo(0.1, 6);
  });
  it("honours the window length", () => {
    const t = { "2026-01": 100, "2026-02": 100, "2026-03": 100, "2026-04": 121 };
    expect(trailingMonthlyInflation(t, 2)).toBeCloseTo(0.1, 6);
  });
  it("throws actionably on a table too short to measure", () => {
    expect(() => trailingMonthlyInflation({ "2026-01": 100 })).toThrow(/fetch-ipc/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/projection.test.ts src/lib/cpi.test.ts src/lib/queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/projection'`; `trailingMonthlyInflation`, `cuotaProjection`, `latestStatementIds` not exported.

- [ ] **Step 3: Implement**

Append to `web/src/lib/cpi.ts`:
```ts
import { monthsBetween } from "@/lib/months";

// Geometric mean monthly inflation over the trailing window — the rate projections grow by.
export function trailingMonthlyInflation(table: CpiTable, n = 6): number {
  const months = Object.keys(table).sort();
  if (months.length < 2) throw new Error(`CPI table too short — run ${CPI_REMEDY}`);
  const last = months[months.length - 1];
  const first = months[Math.max(0, months.length - 1 - n)];
  const periods = monthsBetween(first, last) - 1; // inclusive span minus one = elapsed months
  return Math.pow(table[last] / table[first], 1 / periods) - 1;
}
```

`web/src/lib/projection.ts`:
```ts
import { addMonth } from "@/lib/months";
import type { ValueMode } from "@/lib/queries";

export type ProjectionMonth = {
  month: string;
  certain: number;   // contractual cuotas from the newest statement per brand
  expected: number;  // detected recurring charges carried forward
  estLow: number;    // variable spend band, low edge
  estHigh: number;   // variable spend band, high edge
};

export function project(input: {
  startMonth: string;
  horizon: number;
  upcoming: { month: string; amount: number }[];
  recurringMonthly: number;
  variableHistory: number[];
  inflation: number;
  mode: ValueMode;
}): ProjectionMonth[] {
  const upcoming = new Map(input.upcoming.map(u => [u.month, u.amount]));
  const low = input.variableHistory.length ? Math.min(...input.variableHistory) : 0;
  const high = input.variableHistory.length ? Math.max(...input.variableHistory) : 0;
  const out: ProjectionMonth[] = [];
  for (let k = 0; k < input.horizon; k++) {
    const month = addMonth(input.startMonth, k);
    const p = Math.pow(1 + input.inflation, k + 1);
    // Recurring and variable spend are assumed to track inflation. So in nominal terms they
    // grow; in constant pesos they are flat. The contractual cuota schedule is the mirror
    // image: fixed in nominal pesos, therefore shrinking in constant ones. USD figures are
    // converted at the latest MEP by the caller; peso drift is not modelled.
    const grow = input.mode === "nominal" ? p : 1;
    const shrink = input.mode === "real" ? p : 1;
    out.push({
      month,
      certain: (upcoming.get(month) ?? 0) / shrink,
      expected: input.recurringMonthly * grow,
      estLow: low * grow,
      estHigh: high * grow,
    });
  }
  return out;
}
```

`web/src/lib/queries.ts` — extract the latest-statement helper and add the projection query:
```ts
import { project, type ProjectionMonth } from "@/lib/projection";
import { trailingMonthlyInflation } from "@/lib/cpi";
import { addMonth } from "@/lib/months";

// Two cards close the same day, and an older statement's installment schedule is superseded
// by the newer one's. LIMIT 1 drops a card; summing all statements double-counts (rev note 7).
export function latestStatementIds(db: Database.Database): number[] {
  return (db.prepare(`
    SELECT s.id FROM statements s
    JOIN (SELECT brand, MAX(closing_date) mc FROM statements GROUP BY brand) x
      ON x.brand = s.brand AND x.mc = s.closing_date
  `).all() as { id: number }[]).map(r => r.id);
}

export function cuotaProjection(
  db: Database.Database, opts: ValueOpts, horizon = 6
): ProjectionMonth[] {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latestMonthSeen = months.at(-1);
  if (!latestMonthSeen) return [];

  const ids = latestStatementIds(db);
  const upcomingRaw = db.prepare(
    `SELECT month, SUM(amount_ars) amount FROM upcoming_installments
     WHERE statement_id IN (${ids.map(() => "?").join(",")}) GROUP BY month ORDER BY month`
  ).all(...ids) as { month: string; amount: number }[];
  const upcoming = upcomingRaw.map(u => ({
    month: u.month,
    amount: toMode(u.amount, latestMonthSeen, opts, ctx.baseMonth),
  }));

  // Recency gate: a subscription last charged in 2025 is not a 2027 obligation. Without it
  // ~87,000 ARS/month of dead merchants ride along, including two that moved to USD billing.
  const cutoff = addMonth(latestMonthSeen, -1);
  const recurring = detectRecurring(rows)
    .filter(r => r.currency === "ARS" && r.lastMonth >= cutoff);
  const recurringNames = new Set(recurring.map(r => r.merchant));
  const recurringMonthly = recurring.reduce(
    (s, r) => s + toMode(r.lastAmount, r.lastMonth, opts, ctx.baseMonth), 0
  );

  // Variable = neither contractual cuota nor detected recurring. Trailing 6 cycle months.
  const trailing = months.slice(-6);
  const variableByMonth = new Map(trailing.map(m => [m, 0]));
  for (const r of rows) {
    if (!variableByMonth.has(r.month)) continue;
    if (r.installment_count != null || recurringNames.has(r.merchant)) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt != null) variableByMonth.set(r.month, variableByMonth.get(r.month)! + amt);
  }

  return project({
    startMonth: addMonth(latestMonthSeen),
    horizon,
    upcoming,
    recurringMonthly,
    variableHistory: [...variableByMonth.values()].filter(v => v > 0),
    inflation: trailingMonthlyInflation(opts.cpi),
    mode: opts.value,
  });
}
```
and inside `eli5`, replace the inline `latestPerBrand` query and its `ids` derivation with:
```ts
  const ids = latestStatementIds(db);
  const latestPerBrand = db.prepare(
    `SELECT closing_date, due_date FROM statements WHERE id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids) as { closing_date: string; due_date: string | null }[];
```

`web/src/components/ProjectionChart.tsx`:
```tsx
"use client";
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

type Row = { month: string; certain: number; expected: number; estLow: number; estHigh: number };

export function ProjectionChart({ data, value }: { data: Row[]; value: ValueMode }) {
  // The estimated layer is a band, never a line — honest uncertainty is a stated principle (spec §1).
  const shaped = data.map(d => ({
    ...d,
    bandBase: d.certain + d.expected + d.estLow,
    bandSpan: Math.max(0, d.estHigh - d.estLow),
  }));
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={shaped}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Legend />
        <Bar dataKey="certain" name="Certain (cuotas)" stackId="s" fill="#0ea5e9" />
        <Bar dataKey="expected" name="Expected (recurring)" stackId="s" fill="#8b5cf6" />
        <Area dataKey="bandBase" stackId="b" stroke="none" fill="none" legendType="none" />
        <Area dataKey="bandSpan" name="Estimated (variable range)" stackId="b"
          stroke="#f59e0b" strokeDasharray="4 3" fill="#f59e0b" fillOpacity={0.25} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/future/page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { latestMonth, trailingMonthlyInflation } from "@/lib/cpi";
import { cuotaProjection } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { ProjectionChart } from "@/components/ProjectionChart";

export const dynamic = "force-dynamic";

export default async function Future({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = cuotaProjection(getDb(), opts);
  const fmt = (n: number) => fmtMoney(n, modes.value);
  const rate = (trailingMonthlyInflation(opts.cpi) * 100).toFixed(1);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">What you will owe</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <ProjectionChart data={data} value={modes.value} />
      <table className="w-full text-sm mt-6">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">Month</th><th className="text-right">Certain</th>
          <th className="text-right">Expected</th><th className="text-right">Estimated range</th>
        </tr></thead>
        <tbody>
          {data.map(d => (
            <tr key={d.month} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1">{d.month}</td>
              <td className="text-right">{fmt(d.certain)}</td>
              <td className="text-right">{fmt(d.expected)}</td>
              <td className="text-right">{fmt(d.estLow)} – {fmt(d.estHigh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-zinc-500 mt-3">
        Three layers, three certainties (spec §5). <strong>Certain</strong> is the contractual
        installment schedule from the newest statement of each card. <strong>Expected</strong> is
        your recurring charges — only those still active in the last two cycles — carried forward.
        <strong> Estimated</strong> is the range your variable spending has occupied over the last
        six cycles: a band, not a line, because it is a guess. Nominal figures grow at the trailing
        6-month inflation rate ({rate}%/month); real figures instead deflate the contractual cuotas
        into today&apos;s pesos.
      </p>
    </main>
  );
}
```

`web/src/components/Nav.tsx` — add after `["/currency", "Currency"]`:
```tsx
  ["/future", "Future"],
```

- [ ] **Step 4: Run tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/future` in **Nominal**. The certain layer for 2026-08 must read **402,290** — 375,290.39 (Visa) + 27,000 (Mastercard), the newest statement of each card only. If it reads ~700k, the superseded 2026-07-02 statement leaked in (rev note 7). Certain must fall to 0 after 2027-01 (Visa's schedule ends there) while expected and estimated continue. Expected should land near **1.48M ARS/month**; if it is nearer 2.1M the recency gate or Task 2's netting is missing. The trailing inflation caption should read about **2.5%/month**. Switch to **Real**: the certain bars shrink month over month while expected stays flat.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/projection.ts web/src/lib/projection.test.ts web/src/lib/cpi.ts \
        web/src/lib/cpi.test.ts web/src/lib/queries.ts web/src/lib/queries.test.ts \
        web/src/components/ProjectionChart.tsx web/src/app/future web/src/components/Nav.tsx
git commit -m "feat: three-layer cuota and spend projection"
```

---

### Task 8: Personal inflation lens (`inflation.ts`) — chart 8

The differentiator: research confirms **no app anywhere** reprices a user's own basket against CPI; the only comparable artifact is Buenos Aires' manual "Tu Inflación" calculator.

Method: a **chained matched-merchant price index**. For each consecutive month pair, use only the merchants charged in *both* months, take the ratio of their summed amounts, and chain it onto the running index. Chaining is what makes the index survive basket churn — Spotify moved from ARS to USD billing mid-2025 and PedidosYa Plus repriced four times, so a fixed base-period basket would break or silently drop merchants. Verified on real data: 21 ARS recurring merchants, and every consecutive link matches 11–15 of them, so the chain never falls back to carry-forward.

The basket is restricted to merchants billed **once per month**, the same gate the jump detector uses (Task 6): a supermarket's visit count is volume, not price, and ungated it produces month-links ranging from 0.74 to 1.41 — which no price index should do.

**Files:**
- Create: `web/src/lib/inflation.ts`, `web/src/app/inflation/page.tsx`, `web/src/components/InflationLines.tsx`
- Test: `web/src/lib/inflation.test.ts`
- Modify: `web/src/lib/queries.ts`, `web/src/components/Nav.tsx`

**Interfaces:**
- Consumes: `detectRecurring`, `monthValue`/`CPI_REMEDY` (T3), `baseRows`.
- Produces:
  - `type BasketPoint = { month: string; personal: number; official: number }`
  - `personalInflationIndex(rows: { merchant: string; month: string; ars: number }[], cpi: CpiTable): BasketPoint[]`
  - `personalInflation(db, cpi): { points: BasketPoint[]; basket: string[] }` — `queries.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/inflation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { personalInflationIndex } from "@/lib/inflation";

const cpi = { "2026-01": 100, "2026-02": 110, "2026-03": 121 };
const r = (merchant: string, month: string, ars: number) => ({ merchant, month, ars });

describe("personalInflationIndex", () => {
  it("starts both series at 100 in the first month", () => {
    const p = personalInflationIndex([r("A", "2026-01", 100), r("A", "2026-02", 100)], cpi);
    expect(p[0]).toEqual({ month: "2026-01", personal: 100, official: 100 });
  });

  it("tracks the basket's own repricing against the official index", () => {
    const p = personalInflationIndex([
      r("A", "2026-01", 100), r("A", "2026-02", 120), r("A", "2026-03", 150),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(120);
    expect(p[1].official).toBeCloseTo(110);
    expect(p[2].personal).toBeCloseTo(150);
    expect(p[2].official).toBeCloseTo(121);
  });

  it("chains on merchants present in BOTH months, so basket churn cannot distort it", () => {
    // B joins in February at a large amount; the Jan->Feb link must use A alone.
    const p = personalInflationIndex([
      r("A", "2026-01", 100),
      r("A", "2026-02", 110), r("B", "2026-02", 900),
      r("A", "2026-03", 121), r("B", "2026-03", 990),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(110);
    expect(p[2].personal).toBeCloseTo(121); // (121+990)/(110+900) = 1.1 chained onto 110
  });

  it("carries the index forward unchanged when two months share no merchant", () => {
    const p = personalInflationIndex([
      r("A", "2026-01", 100), r("B", "2026-02", 500), r("B", "2026-03", 600),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(100);
    expect(p[2].personal).toBeCloseTo(120);
  });

  it("returns an empty series for an empty basket", () => {
    expect(personalInflationIndex([], cpi)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/inflation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/inflation'`.

- [ ] **Step 3: Implement**

`web/src/lib/inflation.ts`:
```ts
import { monthValue, CPI_REMEDY, type CpiTable } from "@/lib/cpi";

export type BasketPoint = { month: string; personal: number; official: number };

type BasketRow = { merchant: string; month: string; ars: number };

// Chained matched-merchant price index, both series based at 100 in the first month.
// Chaining (rather than a fixed base basket) is what survives real basket churn: merchants
// enter, leave, and switch billing currency across 19 months of statements.
export function personalInflationIndex(rows: BasketRow[], cpi: CpiTable): BasketPoint[] {
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? new Map<string, number>();
    m.set(r.merchant, (m.get(r.merchant) ?? 0) + r.ars);
    byMonth.set(r.month, m);
  }
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return [];

  const cpiBase = monthValue(months[0], cpi, CPI_REMEDY);
  const out: BasketPoint[] = [{ month: months[0], personal: 100, official: 100 }];
  let personal = 100;
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1])!;
    const cur = byMonth.get(months[i])!;
    let prevSum = 0, curSum = 0;
    for (const [merchant, amount] of cur) {
      const before = prev.get(merchant);
      if (before === undefined) continue; // only merchants charged in both months link the chain
      prevSum += before;
      curSum += amount;
    }
    if (prevSum > 0) personal *= curSum / prevSum;
    out.push({
      month: months[i],
      personal,
      official: 100 * (monthValue(months[i], cpi, CPI_REMEDY) / cpiBase),
    });
  }
  return out;
}
```

Append to `web/src/lib/queries.ts`:
```ts
import { personalInflationIndex, type BasketPoint } from "@/lib/inflation";

// Chart 8. The basket is the user's own detected ARS recurring charges — not a survey basket.
// Restricted to merchants billed once in a month, for the same reason the jump detector is:
// a busier month at the supermarket is volume, not a price rise.
export function personalInflation(
  db: Database.Database, cpi: CpiTable
): { points: BasketPoint[]; basket: string[] } {
  const rows = baseRows(db);
  const names = new Set(
    detectRecurring(rows).filter(r => r.currency === "ARS").map(r => r.merchant)
  );
  const charges = new Map<string, number>();
  for (const r of rows) {
    if (!names.has(r.merchant) || r.ars == null || r.installment_count != null) continue;
    const key = `${r.merchant}|${r.month}`;
    charges.set(key, (charges.get(key) ?? 0) + 1);
  }
  const basketRows: { merchant: string; month: string; ars: number }[] = [];
  for (const r of rows) {
    if (!names.has(r.merchant) || r.ars == null || r.ars <= 0 || r.installment_count != null) continue;
    if (charges.get(`${r.merchant}|${r.month}`) !== 1) continue;
    basketRows.push({ merchant: r.merchant, month: r.month, ars: r.ars });
  }
  return {
    points: personalInflationIndex(basketRows, cpi),
    basket: [...new Set(basketRows.map(r => r.merchant))].sort(),
  };
}
```

`web/src/components/InflationLines.tsx`:
```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function InflationLines({ data }: { data: { month: string; personal: number; official: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => Math.round(v).toString()} fontSize={12} width={60} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} />
        <Legend />
        <Line type="monotone" dataKey="personal" name="Your basket" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="official" name="INDEC IPC" stroke="#71717a" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

`web/src/app/inflation/page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { personalInflation } from "@/lib/queries";
import { InflationLines } from "@/components/InflationLines";

export const dynamic = "force-dynamic";

export default async function Inflation() {
  const { points, basket } = personalInflation(getDb(), loadCpi());
  const last = points.at(-1);
  const gap = last ? last.personal - last.official : 0;
  return (
    <main>
      <h1 className="text-xl font-semibold mb-2">Your inflation vs INDEC</h1>
      {last && (
        <p className="text-sm mb-4">
          Since {points[0].month}, your recurring basket is up{" "}
          <strong>{(last.personal - 100).toFixed(1)}%</strong> while official IPC is up{" "}
          <strong>{(last.official - 100).toFixed(1)}%</strong> —{" "}
          <span className={gap > 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
            {gap > 0 ? "you are paying more than average" : "you are beating average inflation"}
          </span>.
        </p>
      )}
      <InflationLines data={points} />
      <p className="text-xs text-zinc-500 mt-3">
        Both indices are based at 100 in {points[0]?.month ?? "the first month"}. Your line reprices
        the {basket.length} merchants you actually pay every month, chained month to month using only
        merchants charged in both — so a merchant joining or leaving never moves the index by itself,
        and only once-a-month charges count, so buying more does not read as paying more.
        Basket: {basket.join(", ")}.
      </p>
    </main>
  );
}
```

`web/src/components/Nav.tsx` — add after `["/anomalies", "Anomalies"]`:
```tsx
  ["/inflation", "Inflation"],
```

- [ ] **Step 4: Run tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/inflation`. Both lines start at 100 in the first cycle month and rise steeply — INDEC is up about **54%** over the window. Your basket line should land in the same neighbourhood, not multiples of it: if it reads near **196**, Task 2's reversal netting is missing and the 2026-07 double-charges are inflating the last link. The basket footnote must list unified names — `HBO MAX`, `PERSONAL`, `OSDE`, `PEDIDOSYA PLUS` — with no `HELP HBOM`/`PERSONAL FLOW` duplicates, proving Task 1 fed this correctly. A basket under 8 merchants means recurring detection regressed; investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/inflation.ts web/src/lib/inflation.test.ts web/src/lib/queries.ts \
        web/src/components/InflationLines.tsx web/src/app/inflation web/src/components/Nav.tsx
git commit -m "feat: personal inflation lens versus INDEC IPC"
```

---

### Task 9: Sankey (chart 2) and calendar heatmap (chart 3)

Both are presentation over the existing query machinery — bundled because neither carries enough logic to earn its own review gate.

Two real traps:

- **Sankey flows must come from one netted map.** Accumulating brand→category and category→merchant separately and dropping non-positives from each independently breaks flow conservation in 6 of 19 real months (a category can net positive while one merchant inside it nets negative). Keying `brand|category|merchant` once and deriving both sides from the survivors conserves by construction — and is less code.
- **The calendar must run in accrual mode regardless of the caller.** Cuota rows repeat across statements at the **original purchase date**, so a naive daily sum paints 2025-07-17 thirteen times over. Accrual collapses each series to its first observed cuota at full price, which is exactly "what did I buy that day".

**Files:**
- Create: `web/src/app/sankey/page.tsx`, `web/src/components/SankeyFlow.tsx`, `web/src/app/calendar/page.tsx`, `web/src/components/CalendarHeatmap.tsx`
- Test: extends `web/src/lib/queries.test.ts`
- Modify: `web/src/lib/queries.ts`, `web/src/components/Nav.tsx`

**Interfaces:**
- Consumes: `baseRows`, `amountCtx`, `effectiveAmount`.
- Produces:
  - `sankeyFlows(db, opts, month): { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] }` — brand → category → merchant for one cycle month; merchants past the top 8 per category collapse into `"<category> — other"`. Recharts' `Sankey` requires index-based links.
  - `dailySpend(db, opts): { date: string; amount: number }[]` — always evaluated with `spend: "accrual"`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/queries.test.ts`:
```ts
import { sankeyFlows, dailySpend } from "@/lib/queries";

describe("sankeyFlows", () => {
  it("emits index-valid brand -> category -> merchant links that conserve flow", () => {
    const db = openDb(":memory:");
    seed(db);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    const name = (i: number) => nodes[i].name;
    expect(nodes.map(n => n.name)).toEqual(expect.arrayContaining(["visa", "mastercard", "food", "transport"]));
    for (const l of links) {
      expect(l.source).toBeGreaterThanOrEqual(0);
      expect(l.target).toBeLessThan(nodes.length);
      expect(l.value).toBeGreaterThan(0);
    }
    // Every category conserves flow: what the cards send in equals what merchants take out.
    const inTo = new Map<string, number>();
    const outOf = new Map<string, number>();
    for (const l of links) {
      const src = name(l.source), tgt = name(l.target);
      if (src === "visa" || src === "mastercard") inTo.set(tgt, (inTo.get(tgt) ?? 0) + l.value);
      else outOf.set(src, (outOf.get(src) ?? 0) + l.value);
    }
    for (const [category, into] of inTo) expect(outOf.get(category)).toBeCloseTo(into, 6);
  });

  it("nets refunds at merchant grain, so food is 800 not 1000", () => {
    const db = openDb(":memory:");
    seed(db);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    const food = links.find(l => nodes[l.source].name === "visa" && nodes[l.target].name === "food")!;
    expect(food.value).toBeCloseTo(800, 6);
  });

  it("drops a merchant that nets to zero without unbalancing its category", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', '2026-07-20', 'REFUNDED', 'REFUNDED', 'food', NULL, ?, NULL, NULL, NULL)`
    );
    ins.run(sid, 5000); ins.run(sid, -5000);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    expect(nodes.map(n => n.name)).not.toContain("REFUNDED");
    const into = links.filter(l => nodes[l.target].name === "food" && nodes[l.source].name === "visa")
      .reduce((s, l) => s + l.value, 0);
    const outOf = links.filter(l => nodes[l.source].name === "food").reduce((s, l) => s + l.value, 0);
    expect(outOf).toBeCloseTo(into, 6);
  });

  it("returns nothing for a month with no statements", () => {
    const db = openDb(":memory:");
    seed(db);
    expect(sankeyFlows(db, o("cash", "nominal"), "2020-01")).toEqual({ nodes: [], links: [] });
  });
});

describe("dailySpend", () => {
  it("counts a cuota series once at full price, not once per statement", () => {
    const db = openDb(":memory:");
    seed(db);
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       SELECT id, 'purchases', '2026-06-15', 'SOFA', 'SOFA', 'shopping', NULL, 1000, NULL, ?, 6
       FROM statements WHERE file = ?`
    );
    ins.run(1, "v_2026_06.json");
    ins.run(2, "v_2026_07.json");
    // Even though the caller asks for cash mode, a calendar is about purchase days: accrual wins.
    const day = dailySpend(db, o("cash", "nominal")).find(d => d.date === "2026-06-15")!;
    expect(day.amount).toBeCloseTo(6000, 6);
  });

  it("emits one entry per dated day and skips undated rows", () => {
    const db = openDb(":memory:");
    seed(db);
    const days = dailySpend(db, o("cash", "nominal"));
    expect(days.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(new Set(days.map(d => d.date)).size).toBe(days.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `sankeyFlows`/`dailySpend` are not exported.

- [ ] **Step 3: Implement**

Append to `web/src/lib/queries.ts`:
```ts
const TOP_MERCHANTS = 8; // per category; the tail becomes one "<category> — other" band

// Chart 2. One netted map keyed brand|category|merchant is the whole trick: deriving both
// link sets from the same survivors makes flow conservation automatic. Accumulating the two
// sides separately and dropping non-positives from each breaks 6 of 19 real months.
export function sankeyFlows(db: Database.Database, opts: ValueOpts, month: string) {
  const empty = { nodes: [] as { name: string }[], links: [] as { source: number; target: number; value: number }[] };
  const all = baseRows(db);
  const ctx = amountCtx(db, all, opts);
  const brandByStatement = new Map(
    (db.prepare("SELECT id, brand FROM statements").all() as { id: number; brand: string }[])
      .map(s => [s.id, s.brand])
  );

  const flows = new Map<string, number>(); // "brand|category|merchant" -> netted amount
  for (const r of all) {
    if (r.month !== month) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue; // negatives ride along and net (rev note 2)
    const brand = brandByStatement.get(r.statement_id) ?? "card";
    const key = `${brand}|${r.category}|${r.merchant}`;
    flows.set(key, (flows.get(key) ?? 0) + amt);
  }
  for (const [k, v] of flows) if (v <= 0) flows.delete(k);
  if (flows.size === 0) return empty;

  const brandToCat = new Map<string, number>();
  const perCategory = new Map<string, Map<string, number>>();
  for (const [k, v] of flows) {
    const [brand, category, merchant] = k.split("|");
    brandToCat.set(`${brand}|${category}`, (brandToCat.get(`${brand}|${category}`) ?? 0) + v);
    const m = perCategory.get(category) ?? new Map<string, number>();
    m.set(merchant, (m.get(merchant) ?? 0) + v); // one merchant, possibly two cards
    perCategory.set(category, m);
  }

  const names: string[] = [];
  const idx = (name: string) => {
    const at = names.indexOf(name);
    return at >= 0 ? at : names.push(name) - 1;
  };
  const links: { source: number; target: number; value: number }[] = [];
  for (const [key, value] of brandToCat) {
    const [brand, category] = key.split("|");
    links.push({ source: idx(brand), target: idx(category), value });
  }
  for (const [category, merchants] of perCategory) {
    const sorted = [...merchants.entries()].sort((a, b) => b[1] - a[1]);
    for (const [merchant, value] of sorted.slice(0, TOP_MERCHANTS)) {
      links.push({ source: idx(category), target: idx(merchant), value });
    }
    const tail = sorted.slice(TOP_MERCHANTS).reduce((s, [, v]) => s + v, 0);
    if (tail > 0) links.push({ source: idx(category), target: idx(`${category} — other`), value: tail });
  }
  return { nodes: names.map(name => ({ name })), links };
}

// Chart 3. Always accrual: a calendar answers "what did I buy that day", and cuota rows are
// re-listed by every statement at their original purchase date (rev note 4 collapses them).
export function dailySpend(db: Database.Database, opts: ValueOpts) {
  const accrual: ValueOpts = { ...opts, spend: "accrual" };
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, accrual);
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.date == null) continue;
    const amt = effectiveAmount(r, accrual, ctx);
    if (amt == null) continue;
    acc.set(r.date, (acc.get(r.date) ?? 0) + amt);
  }
  return [...acc.entries()].map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
```

`web/src/components/SankeyFlow.tsx`:
```tsx
"use client";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function SankeyFlow({ data, value }: {
  data: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  value: ValueMode;
}) {
  if (data.nodes.length === 0) {
    return <p className="text-sm text-zinc-500">No spending in this month.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(420, data.nodes.length * 22)}>
      <Sankey data={data} nodePadding={18} nodeWidth={12}
        node={{ fill: "#0ea5e9" }} link={{ stroke: "#94a3b8", strokeOpacity: 0.3 }}>
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
      </Sankey>
    </ResponsiveContainer>
  );
}
```

`web/src/app/sankey/page.tsx`:
```tsx
import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { sankeyFlows, coverage } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { SankeyFlow } from "@/components/SankeyFlow";

export const dynamic = "force-dynamic";

export default async function SankeyPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const months = coverage(db).map(c => c.month);
  const month = typeof sp.month === "string" && months.includes(sp.month)
    ? sp.month
    : months.at(-1) ?? "";
  const data = sankeyFlows(db, opts, month);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Where {month} went</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <div className="flex flex-wrap gap-2 text-sm mb-4">
        {months.map(m => (
          <Link key={m} href={withModes("/sankey", modes, { month: m })}
            className={m === month ? "font-bold underline" : "hover:underline"}>{m}</Link>
        ))}
      </div>
      <SankeyFlow data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        Card → category → merchant for one cycle month. Only the top 8 merchants per category get
        their own band; the rest are grouped. Refunds net against their own merchant before the
        flow is drawn, so every category&apos;s inflow equals its outflow.
      </p>
    </main>
  );
}
```

`web/src/components/CalendarHeatmap.tsx`:
```tsx
"use client";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

const CELL = 13, GAP = 2, WEEK = CELL + GAP;

export function CalendarHeatmap({ data, value }: {
  data: { date: string; amount: number }[]; value: ValueMode;
}) {
  if (data.length === 0) return <p className="text-sm text-zinc-500">No dated purchases.</p>;
  const max = Math.max(...data.map(d => d.amount));
  const byDate = new Map(data.map(d => [d.date, d.amount]));
  const start = new Date(`${data[0].date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // snap back to Sunday
  const end = new Date(`${data[data.length - 1].date}T00:00:00Z`);
  const weeks = Math.ceil((end.getTime() - start.getTime()) / (7 * 86400_000)) + 1;

  const cells: { x: number; y: number; date: string; amount: number }[] = [];
  const labels: { x: number; text: string }[] = [];
  let lastMonth = "";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * 86400_000);
      const iso = day.toISOString().slice(0, 10);
      cells.push({ x: w * WEEK, y: d * WEEK, date: iso, amount: byDate.get(iso) ?? 0 });
      if (d === 0) {
        const m = iso.slice(0, 7);
        if (m !== lastMonth) { labels.push({ x: w * WEEK, text: m }); lastMonth = m; }
      }
    }
  }
  return (
    <div className="overflow-x-auto">
      <svg width={weeks * WEEK + 8} height={7 * WEEK + 22} role="img" aria-label="Daily spend heatmap">
        {labels.map(l => (
          <text key={l.text} x={l.x} y={8} fontSize={8} fill="currentColor" opacity={0.6}>{l.text}</text>
        ))}
        {cells.map(c => (
          <rect key={c.date} x={c.x} y={c.y + 14} width={CELL} height={CELL} rx={2}
            fill={c.amount > 0 ? "#0ea5e9" : "currentColor"}
            fillOpacity={c.amount > 0 ? 0.15 + 0.85 * (c.amount / max) : 0.06}>
            <title>{`${c.date}: ${c.amount > 0 ? fmtMoney(c.amount, value) : "no purchases"}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
```

`web/src/app/calendar/page.tsx`:
```tsx
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { dailySpend } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";

export const dynamic = "force-dynamic";

export default async function Calendar({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = dailySpend(getDb(), opts);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Daily spend</h1>
        {/* No spend toggle: a calendar is always about purchase days, so this page forces accrual. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
      <CalendarHeatmap data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        Purchase dates, not billing dates. Installment purchases count once at full price on the day
        they were bought — statements re-list them every month at the original date, which would
        otherwise repaint the same day a dozen times. That also means the grid reaches back before
        the first statement: six cuota series were bought in late 2024 and are still being paid off.
        Hover a cell for the total.
      </p>
    </main>
  );
}
```

`web/src/components/Nav.tsx` — add after `["/categories", "Categories"]`:
```tsx
  ["/sankey", "Sankey"],
  ["/calendar", "Calendar"],
```

- [ ] **Step 4: Run tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/sankey` — the newest cycle month is selected by default; two card nodes on the left (visa, mastercard) fan into categories and then merchants. Mastercard carries purchases in only **5** of the 19 cycle months (2025-01, 2025-04, 2026-01, 2026-06, 2026-07), so it is absent from most months' diagrams — that is real coverage, not a bug. Node bands must line up: a category's inbound width equals the sum of its outbound bands.

Open `/calendar` — the grid spans **2024-08 to 2026-07 (~24 months)**, not just the statement window, because six cuota series were purchased before the first statement and carry their original dates. 2025-07-17 is a single very dark cell (`TIENDANEWSAN`'s 18-cuota purchase at full price, ~3.0M ARS), not one cell per statement. The Purchases/As-billed toggle is absent on this page by design.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts web/src/components/SankeyFlow.tsx \
        web/src/components/CalendarHeatmap.tsx web/src/app/sankey web/src/app/calendar \
        web/src/components/Nav.tsx
git commit -m "feat: sankey flow and calendar heatmap charts"
```

---

### Task 10: Wire the new signals into the ELI5 screen

Phase 1's overview shows integrity alerts only, and a "committed next month" tile taken straight off the installment schedule. With the anomaly engine and the projection in place, the two headline tiles can finally answer the spec's questions properly: "Anything wrong?" and "You'll owe ~Z on the due date" (spec §4).

**Files:**
- Modify: `web/src/lib/queries.ts`, `web/src/lib/queries.test.ts`, `web/src/app/page.tsx`

**Interfaces:**
- Consumes: `anomalies` (T6), `cuotaProjection` (T7).
- Produces: `eli5` gains `openAnomalies: Anomaly[]` (unresolved only, newest first, capped at 5) and `nextStatementForecast: { certain: number; expected: number; estLow: number; estHigh: number }`, and **loses `committedNextMonth`**, which the forecast tile supersedes. All other fields keep their names and types.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/queries.test.ts`, delete the now-obsolete assertion `expect(t.committedNextMonth).toBe(250);` from the existing eli5 test (the `cuotaMonths`/`cuotaTotal` assertions stay — the cuota-burden tile still uses them), and append:
```ts
describe("eli5 phase 2 tiles", () => {
  it("forecasts the next statement as three layers", () => {
    const db = openDb(":memory:");
    seed(db);
    const t = eli5(db, o("cash", "nominal"));
    expect(t.nextStatementForecast.certain).toBeCloseTo(250, 6); // newest statement per brand
    expect(t.nextStatementForecast.estHigh).toBeGreaterThanOrEqual(t.nextStatementForecast.estLow);
  });

  it("surfaces unresolved anomalies and hides the ones the statement already reversed", () => {
    const db = openDb(":memory:");
    seed(db);
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       SELECT id, 'purchases', '2026-07-14', 'ACME', 'ACME', 'shopping', NULL, ?, NULL, NULL, NULL
       FROM statements WHERE file = 'v_2026_07.json'`
    );
    ins.run(90000); ins.run(90000);                  // open duplicate
    ins.run(80000); ins.run(80000); ins.run(-80000); // duplicate the bank already reversed
    const t = eli5(db, o("cash", "nominal"));
    expect(t.openAnomalies.every(a => !a.resolved)).toBe(true);
    const dupes = t.openAnomalies.filter(a => a.kind === "duplicate");
    expect(dupes.map(a => a.amount)).toEqual([90000]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `nextStatementForecast` / `openAnomalies` are undefined.

- [ ] **Step 3: Implement**

In `web/src/lib/queries.ts`, inside `eli5`, add before the `return`:
```ts
  const openAnomalies = anomalies(db, opts.cpi).filter(a => !a.resolved).slice(0, 5);
  const [next] = cuotaProjection(db, opts, 1);
  const nextStatementForecast = next
    ? { certain: next.certain, expected: next.expected, estLow: next.estLow, estHigh: next.estHigh }
    : { certain: 0, expected: 0, estLow: 0, estHigh: 0 };
```
add both to the returned object, and **delete the `committedNextMonth` property** — nothing reads it once the tile below lands:
```ts
    openAnomalies,
    nextStatementForecast,
```

`web/src/app/page.tsx` — replace the "Committed next month" and "Alerts" tiles:
```tsx
        <Tile href={withModes("/future", modes)} label="Next statement forecast">
          <div className="text-2xl font-bold">
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estLow, modes.value)}
            {" – "}
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estHigh, modes.value)}
          </div>
          <div className="text-sm text-zinc-500">
            {fmtMoney(t.nextStatementForecast.certain, modes.value)} contractual · due after {t.nextDueDate ?? "—"}
          </div>
        </Tile>
        <Tile href={withModes("/anomalies", modes)} label="Alerts">
          <div className="text-2xl font-bold">{t.alerts.length + t.openAnomalies.length}</div>
          {t.alerts.length + t.openAnomalies.length === 0
            ? <div className="text-sm text-zinc-500">statements add up, nothing odd</div>
            : <>
                {t.alerts.map((a, i) => <div key={`a${i}`} className="text-xs text-red-600">{a.message}</div>)}
                {t.openAnomalies.map((a, i) => (
                  <div key={`n${i}`} className="text-xs text-red-600">{a.merchant}: {a.message}</div>
                ))}
              </>}
        </Tile>
```

- [ ] **Step 4: Run the full suite and build**

Run: `cd web && npm test && npm run build`
Expected: PASS + build success.

- [ ] **Step 5: Verify against real data**

Open `/`. The forecast tile shows a range whose lower bound exceeds the 402,290 ARS contractual figure, and clicking it lands on `/future`. The Alerts tile shows a small non-zero count: the three reversed 2026-07 duplicates must **not** appear (the bank already corrected them), while the four new 2026-07 merchants do. Switch to **USD**: every tile re-denominates and reads `US$ …`, with no stray peso signs.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts web/src/app/page.tsx
git commit -m "feat: forecast and anomaly tiles on the overview screen"
```

---

## Phase 2 Done Criteria

- `npm run ingest` loads 27 statements with 0 integrity alerts; `HELP%`, `PERSONAL FLOW`, `GOOGLE YOUTUBEP P%`, `LEF CASA%` and `CASASSA%LI%` merchants no longer exist, and no merchant name contains a baked-in amount.
- `npm test` green; `npm run build` clean.
- Three value modes (`real`/`nominal`/`usd`), two spend modes, two tax modes — persisted across navigation. Every chart and tile renders `US$` in USD mode and pesos otherwise. `/recurring` is deliberately nominal-only and carries no toggle.
- No statement's true-cost multiplier exceeds ~1.25.
- New pages render real data: `/currency` (chart 9), `/anomalies` (chart 10), `/future` (chart 4), `/inflation` (chart 8), `/sankey` (chart 2), `/calendar` (chart 3).
- `/future` reports 2026-08 contractual = **402,290 ARS** in nominal mode and expected ≈ **1.48M**.
- `/anomalies` shows **13** findings: 3 duplicates (all 2026-07, all greyed as resolved), 6 price jumps, 4 new merchants. No tips, no cuota rows, no HOYTS.
- `/inflation` plots a personal basket line against INDEC IPC, both based at 100, ending within the same order of magnitude as INDEC's ~154.
- Every Sankey month conserves flow: each category's inbound width equals its outbound total.

## Deferred to Phase 3

Per spec §10: drag-drop PDF upload behind a route handler invoking `scripts/pdf_to_json.py`; LLM-assisted categorization (merchant string only, writes `data/merchant-categories.json`, manual override wins — spec §7); alert history and a review UI over the `alerts` table; auto-promoting repeated manual recategorizations into rules (research: Actual's behavior-learned rules). Also deferred: purchase-date CPI keying (cycle-midpoint keying has held up across two phases), a confidence-gated review queue for low-confidence categorizations (research: Copilot Intelligence), and a percentile-based estimated band (min/max over six cycles is wide — roughly 3.5× on real data — but honest).
