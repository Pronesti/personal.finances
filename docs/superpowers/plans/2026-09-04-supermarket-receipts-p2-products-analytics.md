# Supermarket Receipts P2 — Products and Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn stored receipt items into canonical products (keyed by Coto article code, seeded from the prototype), compute every analysis of the prototype dashboard on read, and show them on three pages plus a review queue for products the matcher had to invent.

**Architecture:** Four new tables (`products`, `product_codes`, `product_rules`, `product_matches`) filled by a matcher that runs at the end of P1's `storeReceipt`. A seed JSON built once from the prototype's `master.json` and P1's recorded transcripts gives the products, their article codes and description rules. Analytics is one pure function over two fact arrays loaded from SQL, tested against the prototype's numbers. Pages are RSCs calling that function; charts use the app's Recharts wrappers.

**Tech Stack:** Next.js 16 (RSC, server actions), TypeScript, better-sqlite3, vitest, Tailwind v4, recharts 3.

**Spec:** `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`, §13 (P2) plus §8 for the analyses. Read it first. **Prerequisite:** P1 is merged (`docs/superpowers/plans/2026-09-04-supermarket-receipts-p1-ingest.md`): `web/src/lib/receipts/{ingest,parse,rows,verify,queries,money}.ts` exist, the receipt tables exist, and `web/src/lib/receipts/__fixtures__/rows/<date>.rows.txt` and `__fixtures__/expected/<date>.json` hold the five recorded receipts.

## Global Constraints

- Node 20 via nvm (`web/.nvmrc`). Run `nvm use` before `npm`. All commands run from `web/` unless a path says otherwise.
- Commit on the current branch (`dev`), one commit per task, message ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Identifiers and comments in English. UI copy only in `web/src/lib/i18n.ts`, both dictionaries, same placeholders (`src/lib/i18n.test.ts`).
- Every route directory needs a `CHROME` entry; pages render no `<h1>` (`src/lib/chrome.test.ts`).
- Money stays `INTEGER` cents and quantities `INTEGER` thousandths in the database. Analytics may use floats for unit prices and ratios; they are derived, never stored.
- Unit prices for analytics derive from `line_total / qty` (gross) and `(line_total + discounts) / qty` (net), never from the printed unit price.
- Product categories are a code constant (12 keys), separate from the charge categories.
- Charts: one y axis per chart; categorical colours assigned per entity in fixed order; 2px lines; a legend whenever a chart has two or more series.
- `npm test` stays fast and offline. The analytics replay test reads P1's recorded transcripts and the prototype's `master.json` from fixtures; it skips itself when the transcripts are absent.

---

## File structure

Created:

| File | Responsibility |
|---|---|
| `web/src/lib/receipts/categories.ts` | The 12 product category keys |
| `web/src/lib/receipts/seed.ts` | `seedProducts(db, file)`: load `data/products-seed.json` into the four tables when empty |
| `web/scripts/build-products-seed.ts` | One-off: prototype `master.json` + recorded transcripts → `data/products-seed.json` |
| `data/products-seed.json` (repo root) | Products, article codes, description rules (tracked) |
| `web/src/lib/receipts/match.ts` | `matchReceipt`, `rematchAll`, `ruleRegex`, `titleCase` |
| `web/src/lib/receipts/products.ts` | Review-queue reads and product edits: `reviewQueue`, `allProducts`, `updateProduct`, `mergeProducts`, `moveCode` |
| `web/src/lib/receipts/facts.ts` | `loadFacts(db)`: receipts and matched items as plain rows |
| `web/src/lib/receipts/analytics.ts` | `buildAnalytics(receipts, items)`: every analysis, pure |
| `web/src/lib/receipts/__fixtures__/master.json` | The prototype's dataset, the analytics oracle |
| `web/src/components/SuperSpendBars.tsx` | Paid + discounts per receipt |
| `web/src/components/SuperIndexLines.tsx` | Index, list vs effective |
| `web/src/components/SuperSavingsBars.tsx` | Savings by promo type per receipt |
| `web/src/components/TrendSparkline.tsx` | Unit-price sparkline for the products table |
| `web/src/app/super/page.tsx` | Overview |
| `web/src/app/super/products/page.tsx` | Products |
| `web/src/app/super/categories/page.tsx` | Categories heatmap |
| `web/src/app/super/review/page.tsx`, `actions.ts` | Review queue and its server actions |

Modified: `web/src/lib/db.ts` (tables + seed call), `web/src/lib/db.test.ts`, `web/src/lib/colors.ts` (product category ramps), `web/src/lib/receipts/ingest.ts` (matcher call), `web/src/lib/i18n.ts`, `web/src/lib/chrome.ts`, `web/src/components/Nav.tsx`, `web/package.json` (script), `web/README.md`.

Types shared across tasks (defined where marked, consumed elsewhere):

```ts
// categories.ts
type ProductCategory = "produce" | "meat_fish" | "dairy" | "deli" | "pantry" | "bakery" | "prepared" | "beverages" | "cleaning" | "personal_care" | "pets" | "other";
// match.ts
type MatchMethod = "code" | "rule" | "auto";
type MatchReport = { matched: number; created: number };
// facts.ts
type ReceiptFact = { id: number; date: string; time: string | null; subtotalCents: number; discountsCents: number; totalCents: number };
type ItemFact = { receiptId: number; productId: number; productName: string; category: ProductCategory; unit: "un" | "kg";
  qtyMilli: number; grossCents: number; discountCents: number; hasM: boolean; hasA: boolean };
// analytics.ts
type PromoType = "mp" | "coto" | "mixed";
type Period = { index: number; receiptId: number; date: string; nItems: number; grossCents: number; discountsCents: number; totalCents: number;
  savingsPct: number; mpCents: number; cotoCents: number; mixedCents: number };
type Appearance = { index: number; date: string; qtyMilli: number; grossCents: number; discountCents: number; netCents: number; unitGross: number; unitNet: number };
type ProductStat = { productId: number; name: string; category: ProductCategory; unit: "un" | "kg"; appearances: Appearance[];
  timesBought: number; totalQtyMilli: number; totalSpentCents: number; totalDiscountCents: number;
  lastChange: { from: number; to: number; grossPct: number; netPct: number } | null };
type CategoryStat = { category: ProductCategory; perPeriod: number[]; totalNetCents: number; totalDiscountCents: number; sharePct: number };
type IndexPoint = { index: number; date: string; list: number; effective: number; factorListPct: number | null; factorEffectivePct: number | null; nProducts: number };
type Kpis = { nPeriods: number; lastTotalCents: number; prevTotalCents: number | null; deltaPct: number | null; avgTotalCents: number;
  monthlyProjectionCents: number; accumulatedTotalCents: number; accumulatedSavingsCents: number };
type BasketChange = { productId: number; name: string; netCents: number };
type Analytics = { periods: Period[]; kpis: Kpis | null; products: ProductStat[]; categories: CategoryStat[]; index: IndexPoint[];
  frequency: { essentials: ProductStat[]; frequent: ProductStat[]; occasional: ProductStat[] };
  basket: { entered: BasketChange[]; left: BasketChange[] }; top: ProductStat[] };
// products.ts
type ReviewProduct = { id: number; name: string; category: ProductCategory; unit: "un" | "kg"; descriptions: string[]; codes: string[]; timesBought: number; totalSpentCents: number };
type ProductOption = { id: number; name: string };
```

---

### Task 1: Product categories — constant, colours, labels

**Files:**
- Create: `web/src/lib/receipts/categories.ts`
- Modify: `web/src/lib/colors.ts`, `web/src/lib/i18n.ts`
- Test: `web/src/lib/receipts/categories.test.ts`

**Interfaces:**
- Produces: `PRODUCT_CATEGORIES` (readonly tuple of the 12 keys), `type ProductCategory`, `isProductCategory(v: unknown): v is ProductCategory`; `ChartTheme.productCategory: Record<ProductCategory, string>`; i18n keys `productCategory.<key>`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/categories.test.ts
import { describe, it, expect } from "vitest";
import { PRODUCT_CATEGORIES, isProductCategory } from "@/lib/receipts/categories";
import { CHART_THEMES } from "@/lib/colors";
import { DICTIONARIES, LOCALES } from "@/lib/i18n";

describe("product categories", () => {
  it("has the twelve keys of the spec, `other` last", () => {
    expect(PRODUCT_CATEGORIES).toEqual([
      "produce", "meat_fish", "dairy", "deli", "pantry", "bakery", "prepared", "beverages",
      "cleaning", "personal_care", "pets", "other",
    ]);
    expect(isProductCategory("dairy")).toBe(true);
    expect(isProductCategory("food")).toBe(false);
  });

  it("has a colour in both schemes and a label in both locales for every key", () => {
    for (const c of PRODUCT_CATEGORIES) {
      expect(CHART_THEMES.light.productCategory[c]).toMatch(/^#[0-9a-f]{6}$/);
      expect(CHART_THEMES.dark.productCategory[c]).toMatch(/^#[0-9a-f]{6}$/);
      for (const locale of LOCALES) expect(DICTIONARIES[locale][`productCategory.${c}`]).toBeTruthy();
    }
  });

  it("gives every category its own colour", () => {
    const light = Object.values(CHART_THEMES.light.productCategory);
    expect(new Set(light).size).toBe(light.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/categories.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/categories`.

- [ ] **Step 3: Write the constant**

```ts
// web/src/lib/receipts/categories.ts
// Supermarket departments, not the card-charge categories of categorize.ts: a receipt line is
// "dairy" or "produce"; the charge that paid for the whole receipt is "food / supermarket".
export const PRODUCT_CATEGORIES = [
  "produce", "meat_fish", "dairy", "deli", "pantry", "bakery", "prepared", "beverages",
  "cleaning", "personal_care", "pets", "other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(v: unknown): v is ProductCategory {
  return typeof v === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Add the ramps to `colors.ts`**

Add the import and the two maps after `CATEGORY_DARK`, the field to `ChartTheme`, and the field to both `LIGHT` and `DARK`. The hues are the twelve already tuned for the charge categories, assigned in fixed order so a category keeps its colour on every chart:

```ts
import type { ProductCategory } from "@/lib/receipts/categories";

// Same twelve tuned hues, fixed per department. `other` takes the grey, as it does for charges.
const PRODUCT_LIGHT: Record<ProductCategory, string> = {
  produce: "#1f9254", meat_fish: "#d43f4f", dairy: "#0b7fbb", deli: "#c8459a", pantry: "#cf7211",
  bakery: "#6b8f19", prepared: "#10897f", beverages: "#4d5bd0", cleaning: "#7c4dcc",
  personal_care: "#6b7280", pets: "#8a90a0", other: "#8f95a3",
};
const PRODUCT_DARK: Record<ProductCategory, string> = {
  produce: "#3fcf82", meat_fish: "#ff7b8a", dairy: "#45b6f5", deli: "#ff7ac4", pantry: "#f5b13c",
  bakery: "#b3d94a", prepared: "#35d4c2", beverages: "#8a97ff", cleaning: "#a98bff",
  personal_care: "#9aa3b2", pets: "#7d8695", other: "#737c8a",
};
```

In `ChartTheme` add `productCategory: Record<ProductCategory, string>;` after `category`. In `LIGHT` add `productCategory: PRODUCT_LIGHT,` and in `DARK` add `productCategory: PRODUCT_DARK,`.

- [ ] **Step 5: Add the labels to `i18n.ts`**

`en` (a new `// ── supermarket products ──` block):

```ts
  "productCategory.produce": "produce",
  "productCategory.meat_fish": "meat, poultry and fish",
  "productCategory.dairy": "dairy and desserts",
  "productCategory.deli": "deli and cured meats",
  "productCategory.pantry": "pantry",
  "productCategory.bakery": "bakery",
  "productCategory.prepared": "prepared food",
  "productCategory.beverages": "beverages",
  "productCategory.cleaning": "cleaning and home",
  "productCategory.personal_care": "personal care",
  "productCategory.pets": "pets",
  "productCategory.other": "other",
```

`es`:

```ts
  "productCategory.produce": "frutas y verduras",
  "productCategory.meat_fish": "carnes, pollo y pescado",
  "productCategory.dairy": "lácteos y postres",
  "productCategory.deli": "fiambres y embutidos",
  "productCategory.pantry": "almacén",
  "productCategory.bakery": "panadería",
  "productCategory.prepared": "comidas elaboradas",
  "productCategory.beverages": "bebidas",
  "productCategory.cleaning": "limpieza y hogar",
  "productCategory.personal_care": "perfumería",
  "productCategory.pets": "mascotas",
  "productCategory.other": "otros",
```

- [ ] **Step 6: Run tests, type-check, commit**

Run: `npx vitest run src/lib/receipts/categories.test.ts src/lib/i18n.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors (every place that builds a `ChartTheme` literal is in `colors.ts`).

```bash
git add src/lib/receipts/categories.ts src/lib/receipts/categories.test.ts src/lib/colors.ts src/lib/i18n.ts
git commit -m "feat(super): product categories with colours and labels"
```

---

### Task 2: Product tables

**Files:**
- Modify: `web/src/lib/db.ts` (inside `migrate()`, after `receipt_transcripts`)
- Modify: `web/src/lib/db.test.ts`

**Interfaces:**
- Produces: tables `products`, `product_codes`, `product_rules`, `product_matches` exactly as spec §13.1.

- [ ] **Step 1: Write the failing test**

Append to `describe("db", ...)` in `web/src/lib/db.test.ts`:

```ts
  it("keys products by article code and cascades codes, rules and matches with the product", () => {
    const db = openDb(":memory:");
    const p = db.prepare(`INSERT INTO products (name, category, unit, created_at) VALUES ('Banana Cavendish (por kg)', 'produce', 'kg', 'now')`).run();
    const pid = Number(p.lastInsertRowid);
    db.prepare(`INSERT INTO product_codes (chain, sku, ean, product_id) VALUES ('coto', '0000000446', '02500446010727', ?)`).run(pid);
    db.prepare(`INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'BANANA CAVENDISH', ?)`).run(pid);
    const r = db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', '2090-1', 'sha', '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run();
    const item = db.prepare(
      `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, qty_milli, unit, line_total_cents)
       VALUES (?, 1, '=BANANA CAVENDISHX KG', '0000000446', 1072, 'kg', 246453)`).run(r.lastInsertRowid);
    db.prepare(`INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, 'code')`).run(item.lastInsertRowid, pid);
    // a second code for the same product is fine; the same code twice for the chain is not
    db.prepare(`INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000447', ?)`).run(pid);
    expect(() => db.prepare(`INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000446', ?)`).run(pid)).toThrow();
    expect(() => db.prepare(`INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, 'guess')`).run(item.lastInsertRowid, pid)).toThrow();
    db.prepare("DELETE FROM products").run();
    expect(db.prepare("SELECT COUNT(*) n FROM product_codes").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM product_rules").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM product_matches").get()).toEqual({ n: 0 });
    // the receipt item itself is untouched: products are a layer over receipts, not part of them
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_items").get()).toEqual({ n: 1 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/db.test.ts`
Expected: FAIL — `no such table: products`.

- [ ] **Step 3: Add the tables**

Inside the `db.exec(\`...\`)` string in `migrate()`, after `receipt_transcripts`:

```sql
    -- Canonical products (spec §13). The article code printed on every receipt line IS the
    -- product identity: product_codes is the primary map, product_rules the fallback for a code
    -- never seen, product_matches the per-item answer written at ingest. Products are a layer
    -- over receipts: deleting one loses its codes, rules and matches, never a receipt line.
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('un','kg')),
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_codes (
      chain TEXT NOT NULL,
      sku TEXT NOT NULL,
      ean TEXT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      PRIMARY KEY (chain, sku)
    );
    -- Ordered: first match wins, so a specific description must sit before a generic one.
    CREATE TABLE IF NOT EXISTS product_rules (
      position INTEGER NOT NULL PRIMARY KEY,
      chain TEXT NOT NULL,
      match TEXT NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE (chain, match)
    );
    CREATE TABLE IF NOT EXISTS product_matches (
      item_id INTEGER PRIMARY KEY REFERENCES receipt_items(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('code','rule','auto'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_matches_product ON product_matches(product_id);
```

- [ ] **Step 4: Run test to verify it passes, commit**

Run: `npx vitest run src/lib/db.test.ts` — PASS.

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(db): product tables keyed by article code"
```

---

### Task 3: Seed — build it from the prototype, load it when empty

**Files:**
- Create: `web/scripts/build-products-seed.ts`
- Create: `data/products-seed.json` (generated by the script, committed)
- Create: `web/src/lib/receipts/seed.ts`
- Test: `web/src/lib/receipts/seed.test.ts`
- Modify: `web/src/lib/db.ts` (`migrate()` seed branch), `web/package.json` (script)

**Interfaces:**
- Consumes: P1 fixtures `__fixtures__/expected/<date>.json` (prototype items per receipt) and `__fixtures__/rows/<date>.rows.txt` (what OCR read, same order); `parseRows`, `parseRowsText` (P1).
- Produces: `type ProductSeed = { products: { name: string; category: ProductCategory; unit: "un" | "kg" }[]; codes: { chain: string; sku: string; ean: string | null; product: string }[]; rules: { match: string; product: string }[] }`; `seedProducts(db, file): void`; `npm run build-products-seed -- <path to master.json>`.

The prototype's `master.json` knows each printed description's canonical product, category and unit, but not the article code. P1's recorded transcripts know the code and the description as OCR actually read it, item by item, in the same order as the prototype's JSON for the same date. Pairing them by date and position gives a seed with codes (so every product already seen matches by code) and rules (the OCR spelling and the prototype spelling, so a description-only match still works).

- [ ] **Step 1: Write the seed loader test**

```ts
// web/src/lib/receipts/seed.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { seedProducts, type ProductSeed } from "@/lib/receipts/seed";

const seed: ProductSeed = {
  products: [
    { name: "Banana Cavendish (por kg)", category: "produce", unit: "kg" },
    { name: "Agua Levité Cero pomelo (2,25 L)", category: "beverages", unit: "un" },
  ],
  codes: [{ chain: "coto", sku: "0000000446", ean: "02500446010727", product: "Banana Cavendish (por kg)" }],
  rules: [
    { match: "AGUA SIN GAS V.D.S LEVITE CEROPOMELO BOT 2.25 LT", product: "Agua Levité Cero pomelo (2,25 L)" },
    { match: "BANANA CAVENDISHX KG", product: "Banana Cavendish (por kg)" },
  ],
};

function write(seedData: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
  const file = path.join(dir, "products-seed.json");
  fs.writeFileSync(file, JSON.stringify(seedData));
  return file;
}

describe("seedProducts", () => {
  it("loads products, codes and ordered rules into an empty database", () => {
    const db = openDb(":memory:");
    seedProducts(db, write(seed));
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products ORDER BY id").all()).toEqual([
      { name: "Banana Cavendish (por kg)", category: "produce", unit: "kg", needs_review: 0 },
      { name: "Agua Levité Cero pomelo (2,25 L)", category: "beverages", unit: "un", needs_review: 0 },
    ]);
    expect(db.prepare("SELECT chain, sku, ean FROM product_codes").all()).toEqual([{ chain: "coto", sku: "0000000446", ean: "02500446010727" }]);
    expect(db.prepare("SELECT position, match FROM product_rules ORDER BY position").all()).toEqual([
      { position: 0, match: "AGUA SIN GAS V.D.S LEVITE CEROPOMELO BOT 2.25 LT" },
      { position: 1, match: "BANANA CAVENDISHX KG" },
    ]);
  });

  it("is a no-op when products exist or the file is missing", () => {
    const db = openDb(":memory:");
    seedProducts(db, path.join(os.tmpdir(), "no-such-seed.json"));
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 0 });
    const file = write(seed);
    seedProducts(db, file);
    seedProducts(db, write({ ...seed, products: [{ name: "Other", category: "other", unit: "un" }] }));
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 2 });
  });

  it("rejects a seed that names an unknown category or product", () => {
    const db = openDb(":memory:");
    expect(() => seedProducts(db, write({ ...seed, products: [{ name: "X", category: "snacks", unit: "un" }], codes: [], rules: [] })))
      .toThrow(/category/);
    expect(() => seedProducts(db, write({ ...seed, rules: [{ match: "X", product: "Nope" }] }))).toThrow(/Nope/);
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 0 }); // transaction rolled back
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/seed.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/seed`.

- [ ] **Step 3: Write the loader**

```ts
// web/src/lib/receipts/seed.ts
import fs from "node:fs";
import type Database from "better-sqlite3";
import { isProductCategory, type ProductCategory } from "./categories";

export type ProductSeed = {
  products: { name: string; category: ProductCategory; unit: "un" | "kg" }[];
  codes: { chain: string; sku: string; ean: string | null; product: string }[];
  rules: { match: string; product: string }[];
};

/**
 * One-time import of data/products-seed.json, guarded on `products` being empty so a second run
 * is a no-op and a database the user has edited is never overwritten. Same contract as the
 * merchant seeds this replaces in spirit. Validates before writing: a typo in the JSON must fail
 * loudly here, not become a product with a category no page knows how to colour.
 */
export function seedProducts(db: Database.Database, file: string): void {
  const count = (db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n;
  if (count > 0 || !fs.existsSync(file)) return;
  const seed = JSON.parse(fs.readFileSync(file, "utf8")) as ProductSeed;
  const load = db.transaction(() => {
    const ids = new Map<string, number>();
    const insertProduct = db.prepare(
      "INSERT INTO products (name, category, unit, needs_review, created_at) VALUES (?, ?, ?, 0, ?)");
    const now = new Date().toISOString();
    for (const p of seed.products) {
      if (!isProductCategory(p.category)) throw new Error(`seed: unknown category "${p.category}" for "${p.name}"`);
      if (p.unit !== "un" && p.unit !== "kg") throw new Error(`seed: unknown unit "${p.unit}" for "${p.name}"`);
      ids.set(p.name, Number(insertProduct.run(p.name, p.category, p.unit, now).lastInsertRowid));
    }
    const idOf = (name: string): number => {
      const id = ids.get(name);
      if (id === undefined) throw new Error(`seed: unknown product "${name}"`);
      return id;
    };
    const insertCode = db.prepare("INSERT INTO product_codes (chain, sku, ean, product_id) VALUES (?, ?, ?, ?)");
    for (const c of seed.codes) insertCode.run(c.chain, c.sku, c.ean, idOf(c.product));
    const insertRule = db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (?, 'coto', ?, ?)");
    seed.rules.forEach((r, i) => insertRule.run(i, r.match, idOf(r.product)));
  });
  load();
}
```

- [ ] **Step 4: Wire it into `migrate()`**

In `web/src/lib/db.ts`, add `import { seedProducts } from "@/lib/receipts/seed";` and, inside the `if (seedDir !== null)` block after `seedAliases(...)`:

```ts
    seedProducts(db, path.join(seedDir, "products-seed.json"));
```

Run: `npx vitest run src/lib/receipts/seed.test.ts src/lib/db.test.ts` — PASS (`:memory:` databases never seed).

- [ ] **Step 5: Write the seed builder**

```ts
// web/scripts/build-products-seed.ts
// One-off: the prototype's master.json (canonical name, category, unit per printed line) paired
// with P1's recorded transcripts (article code and description as OCR read it, same order) →
// data/products-seed.json. Receipts are paired by their printed date, items by position.
//
//   npx tsx scripts/build-products-seed.ts ~/Desktop/Super/analisis/datos/master.json
import fs from "node:fs";
import path from "node:path";
import { parseRowsText } from "../src/lib/receipts/rows";
import { parseRows } from "../src/lib/receipts/parse";
import type { ProductCategory } from "../src/lib/receipts/categories";
import type { ProductSeed } from "../src/lib/receipts/seed";

type MasterItem = { week: number; date: string; desc_printed: string; canonical: string; category: string; unit: "un" | "kg" };
type Master = { items: MasterItem[] };

const CATEGORY_KEY: Record<string, ProductCategory> = {
  "Frutas y Verduras": "produce", "Carnes, Pollo y Pescado": "meat_fish", "Lácteos y Postres": "dairy",
  "Fiambres y Embutidos": "deli", "Almacén": "pantry", "Panadería": "bakery", "Comidas Elaboradas": "prepared",
  "Bebidas": "beverages", "Limpieza y Hogar": "cleaning", "Perfumería": "personal_care", "Mascotas": "pets", "Otros": "other",
};

const masterPath = process.argv[2];
if (!masterPath) { console.error("usage: build-products-seed.ts <master.json>"); process.exit(2); }
const master = JSON.parse(fs.readFileSync(masterPath, "utf8")) as Master;
const rowsDir = path.resolve(__dirname, "../src/lib/receipts/__fixtures__/rows");
const out = path.resolve(__dirname, "../../data/products-seed.json");

const norm = (s: string) => s.replace(/^=/, "").replace(/\s+/g, " ").trim().toUpperCase();

const products = new Map<string, ProductSeed["products"][number]>();
const codes = new Map<string, ProductSeed["codes"][number]>();
const rules = new Map<string, string>(); // match → product name

for (const it of master.items) {
  const category = CATEGORY_KEY[it.category];
  if (!category) throw new Error(`no key for category "${it.category}"`);
  const existing = products.get(it.canonical);
  if (existing && (existing.category !== category || existing.unit !== it.unit))
    throw new Error(`"${it.canonical}" has two categories or units in master.json`);
  products.set(it.canonical, { name: it.canonical, category, unit: it.unit });
  rules.set(norm(it.desc_printed), it.canonical);
}

// Pair each recorded receipt with the prototype's items of the same date, position by position.
const byDate = new Map<string, MasterItem[]>();
for (const it of master.items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
for (const file of fs.readdirSync(rowsDir).filter(f => f.endsWith(".rows.txt")).sort()) {
  const parsed = parseRows(parseRowsText(fs.readFileSync(path.join(rowsDir, file), "utf8")));
  const expected = byDate.get(parsed.header.date ?? "");
  if (!expected) throw new Error(`${file}: master.json has no receipt dated ${parsed.header.date}`);
  if (expected.length !== parsed.items.length)
    throw new Error(`${file}: ${parsed.items.length} items read, master.json has ${expected.length}`);
  parsed.items.forEach((item, i) => {
    const canonical = expected[i].canonical;
    if (item.sku) {
      const prev = codes.get(item.sku);
      if (prev && prev.product !== canonical)
        throw new Error(`${file}: code ${item.sku} maps to "${prev.product}" and "${canonical}"`);
      codes.set(item.sku, { chain: "coto", sku: item.sku, ean: item.ean, product: canonical });
    }
    rules.set(norm(item.descPrinted), canonical);
  });
}

// Longer descriptions first: a specific line must be tried before a generic one it contains.
const seed: ProductSeed = {
  products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name)),
  codes: [...codes.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
  rules: [...rules.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([match, product]) => ({ match, product })),
};
fs.writeFileSync(out, JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.products.length} products, ${seed.codes.length} codes, ${seed.rules.length} rules → ${path.relative(process.cwd(), out)}`);
```

Add to `web/package.json` scripts: `"build-products-seed": "tsx scripts/build-products-seed.ts"`.

- [ ] **Step 6: Build the seed and eyeball it**

Run: `npm run build-products-seed -- ~/Desktop/Super/analisis/datos/master.json`
Expected: `79 products, ~85 codes, ~100 rules → ../data/products-seed.json`. Codes are fewer than lines because the same product recurs; if the script throws "code X maps to two products", the prototype merged two article codes under one name or split one code across two — look at the two lines in `master.json`, decide which is right, and fix `master.json`'s copy under `__fixtures__` (Task 5 copies it) before rerunning; say so in the commit.

Open `data/products-seed.json`: every `category` is one of the twelve keys; `rules` start with the longest descriptions.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-products-seed.ts package.json src/lib/receipts/seed.ts src/lib/receipts/seed.test.ts src/lib/db.ts ../data/products-seed.json
git commit -m "feat(super): product seed built from the prototype and the recorded transcripts"
```

---

### Task 4: The matcher, run at ingest

**Files:**
- Create: `web/src/lib/receipts/match.ts`
- Test: `web/src/lib/receipts/match.test.ts`
- Modify: `web/src/lib/receipts/ingest.ts` (one call in `storeReceipt`)

**Interfaces:**
- Consumes: tables of Task 2; `storeReceipt` (P1).
- Produces: `matchReceipt(db, receiptId): MatchReport`, `rematchAll(db): MatchReport`, `ruleRegex(match: string): RegExp`, `titleCase(desc: string): string`, `type MatchMethod`, `type MatchReport = { matched: number; created: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/match.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchReceipt, rematchAll, ruleRegex, titleCase } from "@/lib/receipts/match";

type Line = { desc: string; sku: string | null; unit?: "un" | "kg" };

function receipt(db: ReturnType<typeof openDb>, fiscal: string, lines: Line[]): number {
  const r = db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, `sha-${fiscal}`);
  const id = Number(r.lastInsertRowid);
  lines.forEach((l, i) => db.prepare(
    `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, ean, qty_milli, unit, line_total_cents)
     VALUES (?, ?, ?, ?, ?, 1000, ?, 100)`).run(id, i + 1, l.desc, l.sku, l.sku ? `0${l.sku}000` : null, l.unit ?? "un"));
  return id;
}
function product(db: ReturnType<typeof openDb>, name: string, category = "produce", unit = "kg"): number {
  return Number(db.prepare("INSERT INTO products (name, category, unit, created_at) VALUES (?, ?, ?, 'now')").run(name, category, unit).lastInsertRowid);
}
const matches = (db: ReturnType<typeof openDb>) =>
  db.prepare(`SELECT i.position, p.name, m.method FROM product_matches m
              JOIN receipt_items i ON i.id = m.item_id JOIN products p ON p.id = m.product_id ORDER BY i.receipt_id, i.position`).all();

describe("ruleRegex / titleCase", () => {
  it("treats the printer's ? as any one character and matches as a substring", () => {
    expect(ruleRegex("PA?UELOS CAMPANITA").test("PAZUELOS CAMPANITACJA 75 UNI")).toBe(true);
    expect(ruleRegex("PA?UELOS CAMPANITA").test("PAÑUELOS CAMPANITA")).toBe(true);
    expect(ruleRegex("FID.PENNE").test("FID.PENNE RIGATE N?4")).toBe(true);
    expect(ruleRegex("FID.PENNE").test("FIDXPENNE")).toBe(false); // the dot is literal
  });
  it("title-cases a printed description without the = marker", () => {
    expect(titleCase("=HUEVO BLANCOCJA 12 UNI")).toBe("Huevo Blancocja 12 Uni");
    expect(titleCase("AGUA  SIN GAS")).toBe("Agua Sin Gas");
  });
});

describe("matchReceipt", () => {
  it("matches by article code first", () => {
    const db = openDb(":memory:");
    const banana = product(db, "Banana Cavendish (por kg)");
    db.prepare("INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000446', ?)").run(banana);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'BANANA', ?)").run(product(db, "Wrong banana"));
    const id = receipt(db, "1", [{ desc: "=BANANA CAVENDISHX KG", sku: "0000000446" }]);
    expect(matchReceipt(db, id)).toEqual({ matched: 1, created: 0 });
    expect(matches(db)).toEqual([{ position: 1, name: "Banana Cavendish (por kg)", method: "code" }]);
  });

  it("falls back to the first rule by position and learns the code", () => {
    const db = openDb(":memory:");
    const specific = product(db, "Huevo blanco (caja 12)");
    const generic = product(db, "Huevo (otros)");
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'HUEVO BLANCOCJA 12', ?)").run(specific);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (1, 'coto', 'HUEVO', ?)").run(generic);
    const id = receipt(db, "1", [{ desc: "=HUEVO BLANCOCJA 12 UNI", sku: "0000022865" }, { desc: "HUEVO COLOR CJA 6", sku: "0000022866" }]);
    matchReceipt(db, id);
    expect(matches(db)).toEqual([
      { position: 1, name: "Huevo blanco (caja 12)", method: "rule" },
      { position: 2, name: "Huevo (otros)", method: "rule" },
    ]);
    expect(db.prepare("SELECT sku, ean, product_id FROM product_codes ORDER BY sku").all()).toEqual([
      { sku: "0000022865", ean: "00000022865000", product_id: specific },
      { sku: "0000022866", ean: "00000022866000", product_id: generic },
    ]);
  });

  it("creates a product flagged for review when nothing matches, once per description", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [
      { desc: "PISI", sku: "0000012345" }, { desc: "PISI", sku: "0000012346" }, { desc: "0,374 KG MORCILLA", sku: null, unit: "kg" },
    ]);
    expect(matchReceipt(db, id)).toEqual({ matched: 3, created: 2 });
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products ORDER BY id").all()).toEqual([
      { name: "Pisi", category: "other", unit: "un", needs_review: 1 },
      { name: "0,374 Kg Morcilla", category: "other", unit: "kg", needs_review: 1 },
    ]);
    expect(matches(db).map(m => m.method)).toEqual(["auto", "auto", "auto"]);
    // both PISI codes now point at the one product
    expect(db.prepare("SELECT COUNT(DISTINCT product_id) n FROM product_codes").get()).toEqual({ n: 1 });
  });

  it("is idempotent and only touches unmatched items", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [{ desc: "PISI", sku: "0000012345" }]);
    matchReceipt(db, id);
    expect(matchReceipt(db, id)).toEqual({ matched: 0, created: 0 });
  });
});

describe("rematchAll", () => {
  it("drops every match and rebuilds from codes and rules, so a moved code takes effect", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [{ desc: "PISI", sku: "0000012345" }]);
    matchReceipt(db, id);
    const real = product(db, "Sopa Pisi", "pantry", "un");
    db.prepare("UPDATE product_codes SET product_id = ? WHERE sku = '0000012345'").run(real);
    expect(rematchAll(db)).toEqual({ matched: 1, created: 0 });
    expect(matches(db)).toEqual([{ position: 1, name: "Sopa Pisi", method: "code" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/match.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/match`.

- [ ] **Step 3: Write the matcher**

```ts
// web/src/lib/receipts/match.ts
import type Database from "better-sqlite3";

export type MatchMethod = "code" | "rule" | "auto";
export type MatchReport = { matched: number; created: number };

/** A rule is a substring of the description; the printer's "?" (ñ, °) stands for any one character. */
export function ruleRegex(match: string): RegExp {
  const escaped = match.replace(/[.*+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}

/** "=HUEVO BLANCOCJA 12 UNI" → "Huevo Blancocja 12 Uni": a readable placeholder until reviewed. */
export function titleCase(desc: string): string {
  return desc.replace(/^=/, "").trim().toLowerCase().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const descOf = (printed: string) => printed.replace(/^=/, "").replace(/\s+/g, " ").trim().toUpperCase();

type Item = { id: number; desc_printed: string; sku: string | null; ean: string | null; unit: "un" | "kg"; chain: string };
type Rule = { match: string; product_id: number };

/**
 * Give every unmatched item of a receipt its product: by article code, else by the first
 * description rule, else by creating a product to review. Codes are learned on the way, so a
 * description matched once by rule is matched by code ever after — and a rule edit later cannot
 * silently move it. One transaction per receipt.
 */
export function matchReceipt(db: Database.Database, receiptId: number): MatchReport {
  const items = db.prepare(`
    SELECT i.id, i.desc_printed, i.sku, i.ean, i.unit, r.chain
    FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
    WHERE i.receipt_id = ? AND i.id NOT IN (SELECT item_id FROM product_matches)
    ORDER BY i.position`).all(receiptId) as Item[];
  const byCode = db.prepare("SELECT product_id FROM product_codes WHERE chain = ? AND sku = ?");
  const rulesOf = db.prepare("SELECT match, product_id FROM product_rules WHERE chain = ? ORDER BY position");
  const byName = db.prepare("SELECT id FROM products WHERE name = ?");
  const insertProduct = db.prepare(
    "INSERT INTO products (name, category, unit, needs_review, created_at) VALUES (?, 'other', ?, 1, ?)");
  const learn = db.prepare("INSERT OR IGNORE INTO product_codes (chain, sku, ean, product_id) VALUES (?, ?, ?, ?)");
  const insertMatch = db.prepare("INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, ?)");
  const rulesCache = new Map<string, Rule[]>();

  const run = db.transaction((): MatchReport => {
    let matched = 0, created = 0;
    for (const it of items) {
      let productId: number | null = null;
      let method: MatchMethod = "auto";
      if (it.sku) {
        const hit = byCode.get(it.chain, it.sku) as { product_id: number } | undefined;
        if (hit) { productId = hit.product_id; method = "code"; }
      }
      if (productId === null) {
        const desc = descOf(it.desc_printed);
        const rules = rulesCache.get(it.chain) ?? (rulesOf.all(it.chain) as Rule[]);
        rulesCache.set(it.chain, rules);
        const rule = rules.find(r => ruleRegex(r.match).test(desc));
        if (rule) { productId = rule.product_id; method = "rule"; }
      }
      if (productId === null) {
        const name = titleCase(it.desc_printed);
        const existing = byName.get(name) as { id: number } | undefined;
        if (existing) productId = existing.id;
        else {
          productId = Number(insertProduct.run(name, it.unit, new Date().toISOString()).lastInsertRowid);
          created++;
        }
        method = "auto";
      }
      if (it.sku && method !== "code") learn.run(it.chain, it.sku, it.ean, productId);
      insertMatch.run(it.id, productId, method);
      matched++;
    }
    return { matched, created };
  });
  return run();
}

/** After a code is moved or a rule edited: rebuild every match from scratch. Auto products stay. */
export function rematchAll(db: Database.Database): MatchReport {
  const receipts = db.prepare("SELECT id FROM receipts ORDER BY date, time, id").all() as { id: number }[];
  const run = db.transaction((): MatchReport => {
    db.prepare("DELETE FROM product_matches").run();
    const total = { matched: 0, created: 0 };
    for (const r of receipts) {
      const report = matchReceipt(db, r.id);
      total.matched += report.matched;
      total.created += report.created;
    }
    return total;
  });
  return run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/match.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Call it from `storeReceipt`**

In `web/src/lib/receipts/ingest.ts` add `import { matchReceipt } from "./match";` and, in `storeReceipt`, right after the `try { id = insert(); } catch ...` block and before the `return`:

```ts
  // Products are a layer over the stored receipt: matched now so every page sees the new
  // receipt at once, in its own transaction so a matcher bug can never lose a verified receipt.
  matchReceipt(db, id);
```

Run: `npx vitest run src/lib/receipts` — every P1 test still passes (their receipts now also get auto products, which nothing there asserts against).

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipts/match.ts src/lib/receipts/match.test.ts src/lib/receipts/ingest.ts
git commit -m "feat(super): match receipt items to products by code, rule, or a new product to review"
```

---

### Task 5: Facts and analytics

**Files:**
- Create: `web/src/lib/receipts/facts.ts`
- Create: `web/src/lib/receipts/analytics.ts`
- Create: `web/src/lib/receipts/__fixtures__/master.json` (copied from `~/Desktop/Super/analisis/datos/master.json`)
- Test: `web/src/lib/receipts/analytics.test.ts`, `web/src/lib/receipts/analytics.replay.test.ts`

**Interfaces:**
- Consumes: tables of Tasks 2–4; `storeReceipt`, `parseRows`, `parseRowsText`, `verify` (P1); `seedProducts` (Task 3).
- Produces: `loadFacts(db): { receipts: ReceiptFact[]; items: ItemFact[] }`; `buildAnalytics(receipts, items): Analytics`; `promoType(hasM, hasA): PromoType | null`; every type in the table at the top.

- [ ] **Step 1: Copy the oracle**

```bash
cp ~/Desktop/Super/analisis/datos/master.json src/lib/receipts/__fixtures__/master.json
```

- [ ] **Step 2: Write the failing unit test (synthetic data, exact numbers)**

Three receipts, three products. Numbers chosen so every derived figure is checkable by hand.

```ts
// web/src/lib/receipts/analytics.test.ts
import { describe, it, expect } from "vitest";
import { buildAnalytics, promoType } from "@/lib/receipts/analytics";
import type { ReceiptFact, ItemFact } from "@/lib/receipts/facts";

const receipts: ReceiptFact[] = [
  { id: 1, date: "2026-08-07", time: "10:00:00", subtotalCents: 500000, discountsCents: -100000, totalCents: 400000 },
  { id: 2, date: "2026-08-14", time: "10:00:00", subtotalCents: 640000, discountsCents: -40000, totalCents: 600000 },
  { id: 3, date: "2026-08-21", time: "10:00:00", subtotalCents: 330000, discountsCents: 0, totalCents: 330000 },
];
const item = (o: Partial<ItemFact> & Pick<ItemFact, "receiptId" | "productId" | "qtyMilli" | "grossCents">): ItemFact => ({
  productName: `P${o.productId}`, category: o.productId === 3 ? "dairy" : "produce", unit: o.productId === 1 ? "kg" : "un",
  discountCents: 0, hasM: false, hasA: false, ...o,
});
const items: ItemFact[] = [
  // receipt 1: banana 1 kg @ 2000, water 2 @ 1000 with a MP discount, milk 1 @ 1000 with both tags
  item({ receiptId: 1, productId: 1, qtyMilli: 1000, grossCents: 200000 }),
  item({ receiptId: 1, productId: 2, qtyMilli: 2000, grossCents: 200000, discountCents: -50000, hasM: true }),
  item({ receiptId: 1, productId: 3, qtyMilli: 1000, grossCents: 100000, discountCents: -50000, hasM: true, hasA: true }),
  // receipt 2: banana 2 kg @ 2200 (+10% list), water 4 @ 1000 with a Coto discount, split in two lines
  item({ receiptId: 2, productId: 1, qtyMilli: 2000, grossCents: 440000 }),
  item({ receiptId: 2, productId: 2, qtyMilli: 2000, grossCents: 200000, discountCents: -40000, hasA: true }),
  item({ receiptId: 2, productId: 2, qtyMilli: 2000, grossCents: 200000 }),
  // receipt 3: banana 1.5 kg @ 2200 (flat), nothing else
  item({ receiptId: 3, productId: 1, qtyMilli: 1500, grossCents: 330000 }),
];

describe("promoType", () => {
  it("classifies by the tags a line carries", () => {
    expect(promoType(true, false)).toBe("mp");
    expect(promoType(false, true)).toBe("coto");
    expect(promoType(true, true)).toBe("mixed");
    expect(promoType(false, false)).toBeNull();
  });
});

describe("buildAnalytics", () => {
  const a = buildAnalytics(receipts, items);

  it("orders periods by date and splits discounts by promo type", () => {
    expect(a.periods.map(p => [p.index, p.date, p.nItems, p.grossCents, p.discountsCents, p.totalCents])).toEqual([
      [1, "2026-08-07", 3, 500000, -100000, 400000],
      [2, "2026-08-14", 3, 640000, -40000, 600000],
      [3, "2026-08-21", 1, 330000, 0, 330000],
    ]);
    expect(a.periods[0]).toMatchObject({ mpCents: -50000, cotoCents: 0, mixedCents: -50000, savingsPct: 20 });
    expect(a.periods[1]).toMatchObject({ mpCents: 0, cotoCents: -40000, mixedCents: 0, savingsPct: 6.25 });
  });

  it("computes the KPIs", () => {
    // The two derived floats are written as the same divisions the code performs, so they are
    // bit-identical; a decimal literal would not be.
    expect(a.kpis).toEqual({
      nPeriods: 3, lastTotalCents: 330000, prevTotalCents: 600000, deltaPct: -45,
      avgTotalCents: 1330000 / 3, monthlyProjectionCents: (1330000 / 3) * 4.33,
      accumulatedTotalCents: 1330000, accumulatedSavingsCents: 140000,
    });
  });

  it("weights a product's appearances by quantity and derives unit prices", () => {
    const water = a.products.find(p => p.productId === 2)!;
    expect(water.appearances).toEqual([
      { index: 1, date: "2026-08-07", qtyMilli: 2000, grossCents: 200000, discountCents: -50000, netCents: 150000, unitGross: 100000, unitNet: 75000 },
      { index: 2, date: "2026-08-14", qtyMilli: 4000, grossCents: 400000, discountCents: -40000, netCents: 360000, unitGross: 100000, unitNet: 90000 },
    ]);
    expect(water.lastChange).toMatchObject({ from: 1, to: 2, grossPct: 0 });
    expect(water.lastChange!.netPct).toBeCloseTo(20, 9); // 90000/75000 is not exactly 1.2 in binary
    expect(water).toMatchObject({ timesBought: 2, totalQtyMilli: 6000, totalSpentCents: 510000, totalDiscountCents: -90000 });
    const banana = a.products.find(p => p.productId === 1)!;
    expect(banana.lastChange).toEqual({ from: 2, to: 3, grossPct: 0, netPct: 0 });
    expect(banana.appearances.map(x => x.unitGross)).toEqual([200000, 220000, 220000]);
    const milk = a.products.find(p => p.productId === 3)!;
    expect(milk.lastChange).toBeNull();
  });

  it("chains the index from each product's previous appearance", () => {
    // period 2: banana 2 kg @ 2200 vs 2000 → 4400/4000; water 4 @ 1000 vs 1000 → 4000/4000.
    // list: (4400+4000)/(4000+4000) = 1.05 ; effective: banana 4400/4000, water 4×900=3600 vs 4×750=3000 → 8000/7000
    // period 3: banana 1.5 @ 2200 vs 2200 → 1.0 (only product with a past)
    expect(a.index.map(p => [p.index, p.nProducts])).toEqual([[1, 0], [2, 2], [3, 1]]);
    expect(a.index[0]).toMatchObject({ list: 100, effective: 100, factorListPct: null, factorEffectivePct: null });
    expect(a.index[1].list).toBeCloseTo(105, 6);
    expect(a.index[1].effective).toBeCloseTo(114.2857, 3);
    expect(a.index[1].factorListPct).toBeCloseTo(5, 6);
    expect(a.index[2].list).toBeCloseTo(105, 6);
    expect(a.index[2].factorListPct).toBeCloseTo(0, 6);
  });

  it("aggregates categories per period with share and discounts", () => {
    expect(a.categories).toEqual([
      { category: "produce", perPeriod: [350000, 800000, 330000], totalNetCents: 1480000, totalDiscountCents: -90000, sharePct: 1480000 * 100 / 1530000 },
      { category: "dairy", perPeriod: [50000, 0, 0], totalNetCents: 50000, totalDiscountCents: -50000, sharePct: 50000 * 100 / 1530000 },
    ]);
  });

  it("sorts habits, basket changes and top products", () => {
    expect(a.frequency.essentials.map(p => p.productId)).toEqual([1]);
    expect(a.frequency.frequent.map(p => p.productId)).toEqual([2]);
    expect(a.frequency.occasional.map(p => p.productId)).toEqual([3]);
    expect(a.basket).toEqual({ entered: [], left: [{ productId: 2, name: "P2", netCents: 360000 }] });
    expect(a.top.map(p => p.productId)).toEqual([1, 2, 3]);
  });

  it("handles no receipts", () => {
    const empty = buildAnalytics([], []);
    expect(empty.periods).toEqual([]);
    expect(empty.kpis).toBeNull();
    expect(empty.index).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/analytics.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/analytics`.

- [ ] **Step 4: Write the facts loader**

```ts
// web/src/lib/receipts/facts.ts
import type Database from "better-sqlite3";
import type { ProductCategory } from "./categories";

export type ReceiptFact = {
  id: number; date: string; time: string | null;
  subtotalCents: number; discountsCents: number; totalCents: number;
};
export type ItemFact = {
  receiptId: number; productId: number; productName: string; category: ProductCategory; unit: "un" | "kg";
  qtyMilli: number; grossCents: number; discountCents: number; hasM: boolean; hasA: boolean;
};

/** Everything the analytics need, as flat rows. Items without a product match are not rows. */
export function loadFacts(db: Database.Database): { receipts: ReceiptFact[]; items: ItemFact[] } {
  const receipts = db.prepare(`
    SELECT id, date, time, subtotal_cents AS subtotalCents, discounts_cents AS discountsCents, total_cents AS totalCents
    FROM receipts ORDER BY date, time, id`).all() as ReceiptFact[];
  const rows = db.prepare(`
    SELECT i.receipt_id AS receiptId, p.id AS productId, p.name AS productName, p.category, p.unit,
           i.qty_milli AS qtyMilli, i.line_total_cents AS grossCents,
           COALESCE((SELECT SUM(d.amount_cents) FROM receipt_discounts d WHERE d.item_id = i.id), 0) AS discountCents,
           EXISTS (SELECT 1 FROM receipt_discounts d WHERE d.item_id = i.id AND d.tag = 'M') AS hasM,
           EXISTS (SELECT 1 FROM receipt_discounts d WHERE d.item_id = i.id AND d.tag = 'A') AS hasA
    FROM receipt_items i
    JOIN product_matches m ON m.item_id = i.id
    JOIN products p ON p.id = m.product_id
    JOIN receipts r ON r.id = i.receipt_id
    ORDER BY r.date, r.time, r.id, i.position`).all() as (Omit<ItemFact, "hasM" | "hasA"> & { hasM: number; hasA: number })[];
  return { receipts, items: rows.map(r => ({ ...r, hasM: r.hasM === 1, hasA: r.hasA === 1 })) };
}
```

- [ ] **Step 5: Write the analytics**

```ts
// web/src/lib/receipts/analytics.ts
import type { ProductCategory } from "./categories";
import type { ReceiptFact, ItemFact } from "./facts";

export type PromoType = "mp" | "coto" | "mixed";
export type Period = {
  index: number; receiptId: number; date: string; nItems: number;
  grossCents: number; discountsCents: number; totalCents: number; savingsPct: number;
  mpCents: number; cotoCents: number; mixedCents: number;
};
export type Appearance = {
  index: number; date: string; qtyMilli: number; grossCents: number; discountCents: number; netCents: number;
  /** Cents per unit or per kg, derived: gross / qty and net / qty. Floats, never stored. */
  unitGross: number; unitNet: number;
};
export type ProductStat = {
  productId: number; name: string; category: ProductCategory; unit: "un" | "kg";
  appearances: Appearance[]; timesBought: number; totalQtyMilli: number; totalSpentCents: number; totalDiscountCents: number;
  lastChange: { from: number; to: number; grossPct: number; netPct: number } | null;
};
export type CategoryStat = {
  category: ProductCategory; perPeriod: number[]; totalNetCents: number; totalDiscountCents: number; sharePct: number;
};
export type IndexPoint = {
  index: number; date: string; list: number; effective: number;
  factorListPct: number | null; factorEffectivePct: number | null; nProducts: number;
};
export type Kpis = {
  nPeriods: number; lastTotalCents: number; prevTotalCents: number | null; deltaPct: number | null;
  avgTotalCents: number; monthlyProjectionCents: number; accumulatedTotalCents: number; accumulatedSavingsCents: number;
};
export type BasketChange = { productId: number; name: string; netCents: number };
export type Analytics = {
  periods: Period[];
  kpis: Kpis | null;
  products: ProductStat[];
  categories: CategoryStat[];
  index: IndexPoint[];
  frequency: { essentials: ProductStat[]; frequent: ProductStat[]; occasional: ProductStat[] };
  basket: { entered: BasketChange[]; left: BasketChange[] };
  top: ProductStat[];
};

export function promoType(hasM: boolean, hasA: boolean): PromoType | null {
  if (hasM && hasA) return "mixed";
  if (hasM) return "mp";
  if (hasA) return "coto";
  return null;
}

const pct = (now: number, before: number) => (now / before - 1) * 100;
const sortReceipts = (a: ReceiptFact, b: ReceiptFact) =>
  a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id - b.id;

/**
 * Every analysis of spec §8, from two flat arrays, in receipt order. Pure: the pages call it on
 * every request and the tests feed it by hand. A "period" is one receipt (decision 6).
 */
export function buildAnalytics(receiptsIn: ReceiptFact[], items: ItemFact[]): Analytics {
  const receipts = [...receiptsIn].sort(sortReceipts);
  const indexOf = new Map(receipts.map((r, i) => [r.id, i + 1]));
  const n = receipts.length;

  // ── periods ──
  const periods: Period[] = receipts.map((r, i) => {
    const mine = items.filter(it => it.receiptId === r.id);
    const split = { mp: 0, coto: 0, mixed: 0 };
    for (const it of mine) {
      const t = promoType(it.hasM, it.hasA);
      if (t) split[t] += it.discountCents;
    }
    return {
      index: i + 1, receiptId: r.id, date: r.date, nItems: mine.length,
      grossCents: r.subtotalCents, discountsCents: r.discountsCents, totalCents: r.totalCents,
      savingsPct: r.subtotalCents === 0 ? 0 : -r.discountsCents * 100 / r.subtotalCents,
      mpCents: split.mp, cotoCents: split.coto, mixedCents: split.mixed,
    };
  });

  // ── kpis ──
  let kpis: Kpis | null = null;
  if (n > 0) {
    const last = periods[n - 1], prev = n > 1 ? periods[n - 2] : null;
    const accumulatedTotalCents = periods.reduce((s, p) => s + p.totalCents, 0);
    const avgTotalCents = accumulatedTotalCents / n;
    kpis = {
      nPeriods: n, lastTotalCents: last.totalCents, prevTotalCents: prev?.totalCents ?? null,
      deltaPct: prev && prev.totalCents !== 0 ? pct(last.totalCents, prev.totalCents) : null,
      avgTotalCents, monthlyProjectionCents: avgTotalCents * 4.33,
      accumulatedTotalCents, accumulatedSavingsCents: -periods.reduce((s, p) => s + p.discountsCents, 0),
    };
  }

  // ── products: one appearance per (product, period), quantity-weighted ──
  const byProduct = new Map<number, ProductStat>();
  for (const it of items) {
    const index = indexOf.get(it.receiptId);
    if (index === undefined) continue;
    const stat = byProduct.get(it.productId) ?? {
      productId: it.productId, name: it.productName, category: it.category, unit: it.unit,
      appearances: [], timesBought: 0, totalQtyMilli: 0, totalSpentCents: 0, totalDiscountCents: 0, lastChange: null,
    };
    let app = stat.appearances.find(a => a.index === index);
    if (!app) {
      app = { index, date: receipts[index - 1].date, qtyMilli: 0, grossCents: 0, discountCents: 0, netCents: 0, unitGross: 0, unitNet: 0 };
      stat.appearances.push(app);
    }
    app.qtyMilli += it.qtyMilli;
    app.grossCents += it.grossCents;
    app.discountCents += it.discountCents;
    app.netCents = app.grossCents + app.discountCents;
    app.unitGross = app.grossCents * 1000 / app.qtyMilli;
    app.unitNet = app.netCents * 1000 / app.qtyMilli;
    byProduct.set(it.productId, stat);
  }
  const products = [...byProduct.values()].map(stat => {
    stat.appearances.sort((a, b) => a.index - b.index);
    stat.timesBought = stat.appearances.length;
    stat.totalQtyMilli = stat.appearances.reduce((s, a) => s + a.qtyMilli, 0);
    stat.totalSpentCents = stat.appearances.reduce((s, a) => s + a.netCents, 0);
    stat.totalDiscountCents = stat.appearances.reduce((s, a) => s + a.discountCents, 0);
    if (stat.appearances.length >= 2) {
      const [from, to] = stat.appearances.slice(-2);
      stat.lastChange = { from: from.index, to: to.index, grossPct: pct(to.unitGross, from.unitGross), netPct: pct(to.unitNet, from.unitNet) };
    }
    return stat;
  }).sort((a, b) => b.totalSpentCents - a.totalSpentCents || a.name.localeCompare(b.name));

  // ── categories ──
  const byCategory = new Map<ProductCategory, CategoryStat>();
  for (const p of products) {
    const c = byCategory.get(p.category) ?? { category: p.category, perPeriod: new Array<number>(n).fill(0), totalNetCents: 0, totalDiscountCents: 0, sharePct: 0 };
    for (const a of p.appearances) c.perPeriod[a.index - 1] += a.netCents;
    c.totalNetCents += p.totalSpentCents;
    c.totalDiscountCents += p.totalDiscountCents;
    byCategory.set(p.category, c);
  }
  const allNet = [...byCategory.values()].reduce((s, c) => s + c.totalNetCents, 0);
  const categories = [...byCategory.values()]
    .map(c => ({ ...c, sharePct: allNet === 0 ? 0 : c.totalNetCents * 100 / allNet }))
    .sort((a, b) => b.totalNetCents - a.totalNetCents);

  // ── chained index: this period's basket at this period's prices vs at each product's previous price ──
  const index: IndexPoint[] = [];
  let list = 100, effective = 100;
  for (let p = 1; p <= n; p++) {
    let numL = 0, denL = 0, numE = 0, denE = 0, nProducts = 0;
    for (const prod of products) {
      const now = prod.appearances.find(a => a.index === p);
      if (!now) continue;
      const before = [...prod.appearances].reverse().find(a => a.index < p);
      if (!before) continue;
      nProducts++;
      numL += now.qtyMilli * now.unitGross; denL += now.qtyMilli * before.unitGross;
      numE += now.qtyMilli * now.unitNet;   denE += now.qtyMilli * before.unitNet;
    }
    const fL = denL > 0 ? numL / denL : null, fE = denE > 0 ? numE / denE : null;
    if (fL !== null) list *= fL;
    if (fE !== null) effective *= fE;
    index.push({
      index: p, date: receipts[p - 1].date, list, effective,
      factorListPct: fL === null ? null : (fL - 1) * 100, factorEffectivePct: fE === null ? null : (fE - 1) * 100, nProducts,
    });
  }

  // ── habits, basket, top ──
  const frequency = {
    essentials: products.filter(p => n >= 2 && p.timesBought === n),
    frequent: products.filter(p => p.timesBought >= 2 && !(n >= 2 && p.timesBought === n)),
    occasional: products.filter(p => p.timesBought === 1),
  };
  const basket = { entered: [] as BasketChange[], left: [] as BasketChange[] };
  if (n >= 2) {
    for (const p of products) {
      const now = p.appearances.find(a => a.index === n), before = p.appearances.find(a => a.index === n - 1);
      if (now && !before) basket.entered.push({ productId: p.productId, name: p.name, netCents: now.netCents });
      if (before && !now) basket.left.push({ productId: p.productId, name: p.name, netCents: before.netCents });
    }
    basket.entered.sort((a, b) => b.netCents - a.netCents);
    basket.left.sort((a, b) => b.netCents - a.netCents);
  }
  return { periods, kpis, products, categories, index, frequency, basket, top: products.slice(0, 15) };
}
```

- [ ] **Step 6: Run the unit test**

Run: `npx vitest run src/lib/receipts/analytics.test.ts`
Expected: PASS (7 tests). Two figures to double-check if one fails: `avgTotalCents` is 1330000/3 (a repeating float, compared exactly because the same division runs in the test's expectation), and period 2's effective factor is (4400 + 3600) / (4000 + 3000) — water's unitNet in period 1 is 75000 cents (net 150000 over 2 units), in period 2 it is 90000 (net 360000 over 4 units).

- [ ] **Step 7: Write the replay test against the prototype**

```ts
// web/src/lib/receipts/analytics.replay.test.ts
// The prototype's master.json is the oracle: replaying the five recorded transcripts through
// storage, the seed, the matcher and the analytics must reproduce its numbers. Offline.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { seedProducts } from "@/lib/receipts/seed";
import { parseRowsText, serializeRows } from "@/lib/receipts/rows";
import { parseRows } from "@/lib/receipts/parse";
import { verify } from "@/lib/receipts/verify";
import { storeReceipt, sha256 } from "@/lib/receipts/ingest";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics, type Analytics } from "@/lib/receipts/analytics";
import type { ProductCategory } from "@/lib/receipts/categories";

type Master = {
  weeks: { week: number; date: string; n_items: number; gross: number; discounts: number; total: number; disc_mp: number; disc_coto: number; disc_mixta: number }[];
  index_series: { week: number; idx_lista: number; idx_efectivo: number; n_products: number }[];
  categories: { category: string; total_net: number; total_discount: number }[];
  products: { canonical: string; times_bought: number; price_change_gross_pct: number | null }[];
};
const CATEGORY_KEY: Record<string, ProductCategory> = {
  "Frutas y Verduras": "produce", "Carnes, Pollo y Pescado": "meat_fish", "Lácteos y Postres": "dairy",
  "Fiambres y Embutidos": "deli", "Almacén": "pantry", "Panadería": "bakery", "Comidas Elaboradas": "prepared",
  "Bebidas": "beverages", "Limpieza y Hogar": "cleaning", "Perfumería": "personal_care", "Mascotas": "pets", "Otros": "other",
};

const FIXTURES = path.join(__dirname, "__fixtures__");
const ROWS = path.join(FIXTURES, "rows");
const SEED = path.resolve(__dirname, "../../../../data/products-seed.json");
const files = fs.existsSync(ROWS) ? fs.readdirSync(ROWS).filter(f => f.endsWith(".rows.txt")).sort() : [];
const cents = (n: number) => Math.round(n * 100);

describe.skipIf(files.length === 0 || !fs.existsSync(SEED))("analytics replay against master.json", () => {
  const master = JSON.parse(fs.readFileSync(path.join(FIXTURES, "master.json"), "utf8")) as Master;
  let a: Analytics;
  let sandbox = "";
  let methods: { method: string; n: number }[] = [];
  let autoProducts: string[] = [];

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "replay-"));
    process.env.TARJETAS_RECEIPT_DIR = sandbox;
    const db = openDb(":memory:");
    seedProducts(db, SEED);
    for (const f of files) {
      const rows = parseRowsText(fs.readFileSync(path.join(ROWS, f), "utf8"));
      const parsed = parseRows(rows);
      const report = verify(parsed);
      if (!report.ok) throw new Error(`${f} no longer reconciles: ${JSON.stringify(report.checks)}`);
      const bytes = Buffer.from(`%PDF-replay-${f}`);
      storeReceipt(db, { parsed, report, sha: sha256(bytes), bytes, scale: 3, transcripts: { ocr: serializeRows(rows) } });
    }
    methods = db.prepare("SELECT method, COUNT(*) n FROM product_matches GROUP BY method").all() as typeof methods;
    autoProducts = (db.prepare("SELECT name FROM products WHERE needs_review = 1").all() as { name: string }[]).map(p => p.name);
    const { receipts, items } = loadFacts(db);
    a = buildAnalytics(receipts, items);
  });
  afterAll(() => {
    delete process.env.TARJETAS_RECEIPT_DIR;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("matches every item from the seed, creating nothing", () => {
    expect(autoProducts, "descriptions the seed did not cover — add a rule for each").toEqual([]);
    expect(methods.find(m => m.method === "auto")).toBeUndefined();
    expect(methods.reduce((s, m) => s + m.n, 0)).toBe(master.weeks.reduce((s, w) => s + w.n_items, 0));
  });

  it("reproduces every period: items, gross, discounts, total and the promo split", () => {
    expect(a.periods.map(p => [p.date, p.nItems, p.grossCents, p.discountsCents, p.totalCents, p.mpCents, p.cotoCents, p.mixedCents]))
      .toEqual(master.weeks.map(w => [w.date, w.n_items, cents(w.gross), cents(w.discounts), cents(w.total), cents(w.disc_mp), cents(w.disc_coto), cents(w.disc_mixta)]));
  });

  it("reproduces the chained index, list and effective, to the prototype's two decimals", () => {
    expect(a.index).toHaveLength(master.index_series.length);
    a.index.forEach((p, i) => {
      const m = master.index_series[i];
      expect(p.nProducts, `period ${p.index}`).toBe(m.n_products);
      expect(p.list, `period ${p.index} list`).toBeCloseTo(m.idx_lista, 1);
      expect(p.effective, `period ${p.index} effective`).toBeCloseTo(m.idx_efectivo, 1);
    });
  });

  it("reproduces the category totals", () => {
    const got = new Map(a.categories.map(c => [c.category, c]));
    for (const m of master.categories) {
      const c = got.get(CATEGORY_KEY[m.category])!;
      expect(c, m.category).toBeDefined();
      expect(c.totalNetCents, m.category).toBe(cents(m.total_net));
      expect(c.totalDiscountCents, m.category).toBe(cents(m.total_discount));
    }
  });

  it("reproduces the product count and the essentials", () => {
    expect(a.products).toHaveLength(master.products.length);
    const n = master.weeks.length;
    expect(a.frequency.essentials.map(p => p.name).sort())
      .toEqual(master.products.filter(p => p.times_bought === n).map(p => p.canonical).sort());
  });
});
```

- [ ] **Step 8: Run it**

Run: `npx vitest run src/lib/receipts/analytics.replay.test.ts`
Expected: PASS (5 tests). If "creating nothing" fails, the message lists the auto-created names: each is a description whose OCR spelling differs from both the prototype's and the recorded one that the seed builder saw (it cannot, for these five receipts — every description in the seed came from these very transcripts — so a failure here means Task 3's pairing used a different fixture set; rebuild the seed). If a category total is off by a few cents, a product has a different category in `master.json` than the seed builder assigned; the seed builder throws on a conflict, so this cannot happen silently either.

- [ ] **Step 9: Commit**

```bash
git add src/lib/receipts/facts.ts src/lib/receipts/analytics.ts src/lib/receipts/analytics.test.ts src/lib/receipts/analytics.replay.test.ts src/lib/receipts/__fixtures__/master.json
git commit -m "feat(super): analytics on read — periods, index, categories, products, habits"
```

---

### Task 6: Chart components

**Files:**
- Create: `web/src/components/SuperSpendBars.tsx`, `web/src/components/SuperIndexLines.tsx`, `web/src/components/SuperSavingsBars.tsx`, `web/src/components/TrendSparkline.tsx`
- Modify: `web/src/lib/i18n.ts` (legend keys)

**Interfaces:**
- Consumes: `useChartTheme`, `axisProps`, `tooltipProps`, `legendProps`, `gridProps`, `barWidth` from `@/components/chart`; `fmtArs` from `@/lib/format`; `useT`.
- Produces: `SuperSpendBars({ data: { label: string; paid: number; discount: number }[] })`, `SuperIndexLines({ data: { label: string; list: number; effective: number }[] })`, `SuperSavingsBars({ data: { label: string; mp: number; coto: number; mixed: number }[] })`, `TrendSparkline({ data: { label: string; value: number }[] })`. All amounts in **pesos** (the pages divide cents by 100 before handing data over, because `fmtArs` takes pesos).

Chart rules applied: one y axis per chart; every multi-series chart has a legend; lines are 2px with no dots; series colours come from the theme and stay fixed per series; grid recessive (`gridProps`).

- [ ] **Step 1: Legend keys**

`en`:

```ts
  "super.legend.paid": "paid",
  "super.legend.discount": "discounts",
  "super.legend.list": "list price",
  "super.legend.effective": "effective price",
  "super.legend.mp": "Mercado Pago",
  "super.legend.coto": "Coto offers",
  "super.legend.mixed": "mixed",
```

`es`:

```ts
  "super.legend.paid": "pagado",
  "super.legend.discount": "descuentos",
  "super.legend.list": "precio de lista",
  "super.legend.effective": "precio efectivo",
  "super.legend.mp": "Mercado Pago",
  "super.legend.coto": "ofertas Coto",
  "super.legend.mixed": "mixto",
```

- [ ] **Step 2: Paid and discounts per receipt**

```tsx
// web/src/components/SuperSpendBars.tsx
"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtArs } from "@/lib/format";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export type SpendPoint = { label: string; paid: number; discount: number };

/** Each receipt as one bar: what was paid, and the discounts on top of it — together, the gross. */
export function SuperSpendBars({ data }: { data: SpendPoint[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="paid" name={tr("super.legend.paid")} stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar dataKey="discount" name={tr("super.legend.discount")} stackId="1" fill={t.series.band} fillOpacity={0.7} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: The index**

```tsx
// web/src/components/SuperIndexLines.tsx
"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

export type IndexChartPoint = { label: string; list: number; effective: number };

/** The chained personal index, first receipt = 100: shelf prices vs what was actually paid per unit. */
export function SuperIndexLines({ data }: { data: IndexChartPoint[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} width={50} {...axisProps(t)} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <ReferenceLine y={100} stroke={t.line} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="list" name={tr("super.legend.list")} stroke={t.series.alert} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="effective" name={tr("super.legend.effective")} stroke={t.series.primary} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Savings by promo type**

```tsx
// web/src/components/SuperSavingsBars.tsx
"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtArs } from "@/lib/format";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export type SavingsPoint = { label: string; mp: number; coto: number; mixed: number };

/** Who funded the discount on each receipt: the payment method, the shelf, or both at once. */
export function SuperSavingsBars({ data }: { data: SavingsPoint[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="coto" name={tr("super.legend.coto")} stackId="1" fill={t.series.secondary} {...barWidth(data.length)} />
        <Bar dataKey="mp" name={tr("super.legend.mp")} stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar dataKey="mixed" name={tr("super.legend.mixed")} stackId="1" fill={t.series.neutral} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: The sparkline**

```tsx
// web/src/components/TrendSparkline.tsx
"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useChartTheme } from "./chart";

/** A unit price over its appearances, inside a table cell. No axes: the row's numbers are the axes. */
export function TrendSparkline({ data }: { data: { label: string; value: number }[] }) {
  const t = useChartTheme();
  return (
    <div className="h-9 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line type="monotone" dataKey="value" stroke={t.series.primary} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit && npx vitest run src/lib/i18n.test.ts` — no errors, PASS.

```bash
git add src/components/SuperSpendBars.tsx src/components/SuperIndexLines.tsx src/components/SuperSavingsBars.tsx src/components/TrendSparkline.tsx src/lib/i18n.ts
git commit -m "feat(super): spend, index and savings charts"
```

---

### Task 7: The three analysis pages, navigation

**Files:**
- Create: `web/src/app/super/page.tsx`, `web/src/app/super/products/page.tsx`, `web/src/app/super/categories/page.tsx`
- Modify: `web/src/components/Nav.tsx`, `web/src/lib/chrome.ts`, `web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `loadFacts`, `buildAnalytics` and its types (Task 5); the four chart components (Task 6); `Stat`, `StatRail`; `fmtArsCents`, `fmtCents` (P1 `money.ts`); `fmtPct` (`format.ts`); `getT`, `getDb`.
- Produces: routes `/super`, `/super/products`, `/super/categories`; the "Supermarket" nav group reordered.

- [ ] **Step 1: Dictionary keys**

`en`:

```ts
  "nav.super": "Overview",
  "nav.superProducts": "Products",
  "nav.superCategories": "Categories",
  "nav.superReview": "Review",

  "super.title": "Supermarket overview",
  "super.products.title": "Supermarket products",
  "super.categories.title": "Supermarket categories",
  "super.review.title": "Products to review",
  "super.empty": "No receipts yet. Upload one on the Receipts page.",
  "super.stat.last": "Last receipt",
  "super.stat.vsPrev": "{pct} vs the previous one",
  "super.stat.first": "first receipt",
  "super.stat.avg": "Average per receipt",
  "super.stat.monthly": "≈ {amount} a month over {count} receipts",
  "super.stat.saved": "Saved so far",
  "super.stat.savedDetail": "{pct} of {gross} at list price",
  "super.chart.spend": "Paid and discounts, per receipt",
  "super.chart.index": "Personal price index (first receipt = 100)",
  "super.chart.indexNote": "List: shelf prices of what you bought. Effective: what you paid per unit after promotions. Both chained from each product's previous purchase.",
  "super.chart.savings": "Savings by promotion type, per receipt",
  "super.footer": "This page sums the supermarket receipts. The first tile is the last receipt and how it compares with the one before. The second is the average per receipt and what that means per month. The third is everything the promotions saved. The first chart stacks what you paid and what the discounts took off, so the full bar is the shelf price of the basket. The index chart follows the prices of the products you buy again: the list line is the shelf price, the effective line is the price paid after promotions; both start at 100 on the first receipt. The last chart shows who funded each week's discount: Mercado Pago, Coto's shelf offers, or both on the same line.",
  "super.products.changes": "Price changes on repeated products",
  "super.products.product": "Product",
  "super.products.category": "Category",
  "super.products.times": "Bought",
  "super.products.lastGross": "List price",
  "super.products.lastNet": "Effective price",
  "super.products.between": "{from} → {to}",
  "super.products.trend": "Unit price",
  "super.products.noRepeats": "No product has been bought twice yet.",
  "super.products.top": "Top products by spend",
  "super.products.spent": "Spent",
  "super.products.qty": "Quantity",
  "super.products.habits": "Habits",
  "super.products.essentials": "On every receipt",
  "super.products.frequent": "More than once",
  "super.products.occasional": "Once",
  "super.products.basket": "Basket changes between the last two receipts",
  "super.products.entered": "Entered",
  "super.products.left": "Left",
  "super.products.nothing": "nothing",
  "super.products.footer": "This page follows each product across receipts. The first table takes every product bought at least twice and compares its unit price on its last two purchases: the list column is the shelf price, the effective column is the price paid after promotions, and the small line draws the shelf price on every purchase. The top table ranks products by what they cost in total. Habits sorts products by how often they come home. The last section lists what appeared and what disappeared between the last two receipts, which explains a jump in the total better than prices do.",
  "super.categories.category": "Category",
  "super.categories.total": "Total",
  "super.categories.share": "Share",
  "super.categories.discounts": "Discounts",
  "super.categories.footer": "This page splits each receipt by department. Each cell is the net spend of a category on one receipt; darker means more. The totals on the right add every receipt, and the share is that category's part of everything bought. Discounts are the promotions captured in that category.",
```

`es`:

```ts
  "nav.super": "Resumen",
  "nav.superProducts": "Productos",
  "nav.superCategories": "Categorías",
  "nav.superReview": "Revisión",

  "super.title": "Resumen del súper",
  "super.products.title": "Productos del súper",
  "super.categories.title": "Categorías del súper",
  "super.review.title": "Productos a revisar",
  "super.empty": "Todavía no hay tickets. Cargá uno en la página de Tickets.",
  "super.stat.last": "Último ticket",
  "super.stat.vsPrev": "{pct} contra el anterior",
  "super.stat.first": "primer ticket",
  "super.stat.avg": "Promedio por ticket",
  "super.stat.monthly": "≈ {amount} por mes sobre {count} tickets",
  "super.stat.saved": "Ahorro acumulado",
  "super.stat.savedDetail": "{pct} de {gross} a precio de lista",
  "super.chart.spend": "Pagado y descuentos, por ticket",
  "super.chart.index": "Índice de precios de tu canasta (primer ticket = 100)",
  "super.chart.indexNote": "Lista: precios de góndola de lo que compraste. Efectivo: lo que pagaste por unidad después de las promos. Ambos encadenados desde la compra anterior de cada producto.",
  "super.chart.savings": "Ahorro por tipo de promoción, por ticket",
  "super.footer": "Esta página suma los tickets del súper. La primera tarjeta es el último ticket y cómo se compara con el anterior. La segunda es el promedio por ticket y lo que eso significa por mes. La tercera es todo lo que ahorraron las promociones. El primer gráfico apila lo que pagaste y lo que descontaron las promos, así que la barra completa es el precio de góndola de la canasta. El gráfico del índice sigue los precios de los productos que volvés a comprar: la línea de lista es el precio de góndola, la efectiva es el precio pagado después de las promos; las dos arrancan en 100 en el primer ticket. El último gráfico muestra quién financió el descuento de cada semana: Mercado Pago, las ofertas de góndola de Coto, o los dos en la misma línea.",
  "super.products.changes": "Cambios de precio en productos repetidos",
  "super.products.product": "Producto",
  "super.products.category": "Categoría",
  "super.products.times": "Comprado",
  "super.products.lastGross": "Precio de lista",
  "super.products.lastNet": "Precio efectivo",
  "super.products.between": "{from} → {to}",
  "super.products.trend": "Precio unitario",
  "super.products.noRepeats": "Ningún producto se compró dos veces todavía.",
  "super.products.top": "Productos con más gasto",
  "super.products.spent": "Gastado",
  "super.products.qty": "Cantidad",
  "super.products.habits": "Hábitos",
  "super.products.essentials": "En todos los tickets",
  "super.products.frequent": "Más de una vez",
  "super.products.occasional": "Una vez",
  "super.products.basket": "Cambios en la canasta entre los últimos dos tickets",
  "super.products.entered": "Entraron",
  "super.products.left": "Salieron",
  "super.products.nothing": "nada",
  "super.products.footer": "Esta página sigue cada producto a lo largo de los tickets. La primera tabla toma cada producto comprado al menos dos veces y compara su precio unitario en las últimas dos compras: la columna de lista es el precio de góndola, la efectiva es el precio pagado después de las promos, y la línea chica dibuja el precio de góndola en cada compra. La tabla siguiente ordena los productos por lo que costaron en total. Hábitos ordena los productos por la frecuencia con que vuelven a casa. La última sección lista qué apareció y qué desapareció entre los últimos dos tickets, que explica un salto del total mejor que los precios.",
  "super.categories.category": "Categoría",
  "super.categories.total": "Total",
  "super.categories.share": "Parte",
  "super.categories.discounts": "Descuentos",
  "super.categories.footer": "Esta página reparte cada ticket por rubro. Cada celda es el gasto neto de una categoría en un ticket; más oscuro es más. Los totales de la derecha suman todos los tickets, y la parte es la porción de esa categoría sobre todo lo comprado. Descuentos son las promociones captadas en esa categoría.",
```

- [ ] **Step 2: Navigation and chrome**

In `web/src/components/Nav.tsx`, replace the supermarket group P1 added with:

```ts
  {
    heading: "nav.group.supermarket",
    links: [
      ["/super", "nav.super"], ["/super/products", "nav.superProducts"], ["/super/categories", "nav.superCategories"],
      ["/receipts", "nav.receipts"], ["/super/review", "nav.superReview"],
    ],
  },
```

In `web/src/lib/chrome.ts`, add (after `/sankey`):

```ts
  "/super": { title: "super.title" },
  "/super/categories": { title: "super.categories.title" },
  "/super/products": { title: "super.products.title" },
  "/super/review": { title: "super.review.title" },
```

`/super/review` gets its page in Task 8; `chrome.test` demands the table and the pages agree, so Task 8 must land before the suite is green again — or add the review entry in Task 8. Do the latter: add only the first three here.

- [ ] **Step 3: The overview page**

```tsx
// web/src/app/super/page.tsx
import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics } from "@/lib/receipts/analytics";
import { fmtArsCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { Stat, StatRail } from "@/components/Stat";
import { SuperSpendBars } from "@/components/SuperSpendBars";
import { SuperIndexLines } from "@/components/SuperIndexLines";
import { SuperSavingsBars } from "@/components/SuperSavingsBars";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

// Receipts are labelled by their date on every axis; "week N" is only an index.
const label = (date: string) => date.slice(5);

export default async function SuperOverview() {
  const tr = await getT();
  const { receipts, items } = loadFacts(getDb());
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const k = a.kpis;
  const gross = a.periods.reduce((s, p) => s + p.grossCents, 0);
  return (
    <main>
      <StatRail stats={
        <>
          <Stat label={tr("super.stat.last")} value={fmtArsCents(k.lastTotalCents)}
            detail={k.deltaPct === null ? tr("super.stat.first") : tr("super.stat.vsPrev", { pct: fmtPct(k.deltaPct) })}
            tone={k.deltaPct === null ? undefined : k.deltaPct > 0 ? "text-negative" : "text-positive"} />
          <Stat label={tr("super.stat.avg")} value={fmtArsCents(Math.round(k.avgTotalCents))}
            detail={tr("super.stat.monthly", { amount: fmtArsCents(Math.round(k.monthlyProjectionCents)), count: k.nPeriods })} />
          <Stat label={tr("super.stat.saved")} value={fmtArsCents(k.accumulatedSavingsCents)}
            detail={tr("super.stat.savedDetail", { pct: fmtPct(gross === 0 ? 0 : k.accumulatedSavingsCents * 100 / gross), gross: fmtArsCents(gross) })} />
        </>
      }>
        <section className="space-y-8">
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.spend")}</h2>
            <SuperSpendBars data={a.periods.map(p => ({ label: label(p.date), paid: p.totalCents / 100, discount: -p.discountsCents / 100 }))} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.index")}</h2>
            <SuperIndexLines data={a.index.map(p => ({ label: label(p.date), list: p.list, effective: p.effective }))} />
            <p className="mt-1 text-xs text-ink-muted">{tr("super.chart.indexNote")}</p>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.savings")}</h2>
            <SuperSavingsBars data={a.periods.map(p => ({ label: label(p.date), mp: -p.mpCents / 100, coto: -p.cotoCents / 100, mixed: -p.mixedCents / 100 }))} />
          </div>
        </section>
      </StatRail>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.footer")}</p>
    </main>
  );
}
```

- [ ] **Step 4: The products page**

```tsx
// web/src/app/super/products/page.tsx
import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics, type ProductStat } from "@/lib/receipts/analytics";
import { fmtArsCents, fmtCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { TrendSparkline } from "@/components/TrendSparkline";
import { getT } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const qty = (milli: number, unit: "un" | "kg") =>
  unit === "kg" ? `${(milli / 1000).toFixed(3).replace(".", ",")} kg` : `${milli / 1000}`;
const tone = (p: number) => (p > 0.05 ? "text-negative" : p < -0.05 ? "text-positive" : "text-ink-muted");

function Habit({ title, products, tr }: { title: string; products: ProductStat[]; tr: Translator }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{title}</h3>
      <ul className="mt-1 text-sm">
        {products.length === 0 && <li className="text-ink-muted">{tr("super.products.nothing")}</li>}
        {products.map(p => <li key={p.productId}>{p.name} <span className="text-ink-muted">· {p.timesBought}</span></li>)}
      </ul>
    </div>
  );
}

export default async function SuperProducts() {
  const tr = await getT();
  const { receipts, items } = loadFacts(getDb());
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const repeated = a.products.filter(p => p.lastChange !== null)
    .sort((x, y) => Math.abs(y.lastChange!.grossPct) - Math.abs(x.lastChange!.grossPct));
  const th = "py-1 text-left text-ink-muted";
  return (
    <main className="space-y-10">
      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.changes")}</h2>
        {repeated.length === 0 ? <p className="text-sm text-ink-muted">{tr("super.products.noRepeats")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line">
                <th className={th}>{tr("super.products.product")}</th><th className={th}>{tr("super.products.category")}</th>
                <th className={`${th} text-right`}>{tr("super.products.times")}</th>
                <th className={`${th} text-right`}>{tr("super.products.lastGross")}</th>
                <th className={`${th} text-right`}>{tr("super.products.lastNet")}</th>
                <th className={th}>{tr("super.products.trend")}</th>
              </tr></thead>
              <tbody>
                {repeated.map(p => {
                  const c = p.lastChange!;
                  const from = p.appearances.find(x => x.index === c.from)!, to = p.appearances.find(x => x.index === c.to)!;
                  return (
                    <tr key={p.productId} className="border-t border-line align-top">
                      <td className="py-1">{p.name}<div className="text-xs text-ink-muted">{tr("super.products.between", { from: from.date, to: to.date })}</div></td>
                      <td>{tr(`productCategory.${p.category}`)}</td>
                      <td className="text-right">{p.timesBought}</td>
                      <td className={`text-right font-mono ${tone(c.grossPct)}`}>{fmtPct(c.grossPct)}<div className="text-xs text-ink-muted">{fmtCents(Math.round(from.unitGross))} → {fmtCents(Math.round(to.unitGross))}</div></td>
                      <td className={`text-right font-mono ${tone(c.netPct)}`}>{fmtPct(c.netPct)}<div className="text-xs text-ink-muted">{fmtCents(Math.round(from.unitNet))} → {fmtCents(Math.round(to.unitNet))}</div></td>
                      <td><TrendSparkline data={p.appearances.map(x => ({ label: x.date, value: x.unitGross / 100 }))} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.top")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.products.product")}</th><th className={th}>{tr("super.products.category")}</th>
            <th className={`${th} text-right`}>{tr("super.products.times")}</th>
            <th className={`${th} text-right`}>{tr("super.products.qty")}</th>
            <th className={`${th} text-right`}>{tr("super.products.spent")}</th>
          </tr></thead>
          <tbody>
            {a.top.map(p => (
              <tr key={p.productId} className="border-t border-line">
                <td className="py-1">{p.name}</td><td>{tr(`productCategory.${p.category}`)}</td>
                <td className="text-right">{p.timesBought}</td>
                <td className="text-right">{qty(p.totalQtyMilli, p.unit)}</td>
                <td className="text-right font-mono">{fmtArsCents(p.totalSpentCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.habits")}</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <Habit title={tr("super.products.essentials")} products={a.frequency.essentials} tr={tr} />
          <Habit title={tr("super.products.frequent")} products={a.frequency.frequent} tr={tr} />
          <Habit title={tr("super.products.occasional")} products={a.frequency.occasional} tr={tr} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.basket")}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {([["super.products.entered", a.basket.entered], ["super.products.left", a.basket.left]] as const).map(([key, list]) => (
            <div key={key}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr(key)}</h3>
              <ul className="mt-1 text-sm">
                {list.length === 0 && <li className="text-ink-muted">{tr("super.products.nothing")}</li>}
                {list.map(b => <li key={b.productId} className="flex justify-between gap-4"><span>{b.name}</span><span className="font-mono">{fmtArsCents(b.netCents)}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.products.footer")}</p>
    </main>
  );
}
```

- [ ] **Step 5: The categories page**

A heatmap as a table: one hue (the accent), opacity proportional to the cell's share of the largest cell. Sequential means one hue, light to dark.

```tsx
// web/src/app/super/categories/page.tsx
import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics } from "@/lib/receipts/analytics";
import { fmtArsCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function SuperCategories() {
  const tr = await getT();
  const { receipts, items } = loadFacts(getDb());
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const max = Math.max(1, ...a.categories.flatMap(c => c.perPeriod));
  const th = "py-1 text-ink-muted";
  return (
    <main>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={`${th} text-left`}>{tr("super.categories.category")}</th>
            {a.periods.map(p => <th key={p.index} className={`${th} text-right font-normal`}>{p.date.slice(5)}</th>)}
            <th className={`${th} text-right`}>{tr("super.categories.total")}</th>
            <th className={`${th} text-right`}>{tr("super.categories.share")}</th>
            <th className={`${th} text-right`}>{tr("super.categories.discounts")}</th>
          </tr></thead>
          <tbody>
            {a.categories.map(c => (
              <tr key={c.category} className="border-t border-line">
                <td className="py-1">{tr(`productCategory.${c.category}`)}</td>
                {c.perPeriod.map((v, i) => (
                  // One hue, light to dark: the accent at an opacity that follows the amount.
                  <td key={i} className="text-right font-mono tabular-nums" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(v / max * 70)}%, transparent)` }}>
                    {v === 0 ? <span className="text-ink-subtle">—</span> : fmtArsCents(v)}
                  </td>
                ))}
                <td className="text-right font-mono">{fmtArsCents(c.totalNetCents)}</td>
                <td className="text-right">{fmtPct(c.sharePct).replace("+", "")}</td>
                <td className="text-right font-mono">{fmtArsCents(c.totalDiscountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.categories.footer")}</p>
    </main>
  );
}
```

`--accent` is the CSS variable the theme defines in `globals.css` (`--color-accent: var(--accent)`); `color-mix` keeps the hue in both schemes.

- [ ] **Step 6: Run the gates and look at the pages**

Run: `npx tsc --noEmit && npx vitest run` — `chrome.test.ts` will fail on `/super/review` only if its CHROME entry was added before its page exists; it was not (Step 2). Everything else green.

Browser (dev server `tarjetas` on port 3000, `nvm use` first if starting it): with the five acceptance receipts uploaded on `/receipts` (or `npm run test:receipts` having run against the real database — it does not; upload them by hand once through the page):
1. `/super`: three tiles, three charts; the index chart's last point reads ≈106.9 list / 102.0 effective for the five prototype receipts.
2. `/super/products`: the repeated-products table lists Banana with its list change and the sparkline; habits show the two essentials (Agua Levité, Banana).
3. `/super/categories`: twelve rows, darker cells where spend is larger, share column sums to 100%.
4. Toggle Español: every label changes. Check dark mode (`resize_window` colorScheme dark): the heatmap stays legible.

- [ ] **Step 7: Commit**

```bash
git add src/app/super src/components/Nav.tsx src/lib/chrome.ts src/lib/i18n.ts
git commit -m "feat(super): overview, products and categories pages"
```

---

### Task 8: The review queue

**Files:**
- Create: `web/src/lib/receipts/products.ts`
- Test: `web/src/lib/receipts/products.test.ts`
- Create: `web/src/app/super/review/page.tsx`, `web/src/app/super/review/actions.ts`
- Modify: `web/src/lib/chrome.ts` (the `/super/review` entry), `web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: tables of Task 2; `rematchAll` (Task 4); `isProductCategory` (Task 1).
- Produces: `reviewQueue(db): ReviewProduct[]`, `allProducts(db): ProductOption[]`, `updateProduct(db, id, patch: { name: string; category: ProductCategory; unit: "un" | "kg"; needsReview: boolean }): void`, `mergeProducts(db, sourceId, targetId): void`, `moveCode(db, chain, sku, targetId): void`; server actions `saveProductAction(formData)`, `mergeProductAction(formData)`, `moveCodeAction(formData)`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/products.test.ts
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchReceipt } from "@/lib/receipts/match";
import { reviewQueue, allProducts, updateProduct, mergeProducts, moveCode } from "@/lib/receipts/products";

type Db = ReturnType<typeof openDb>;
function receipt(db: Db, fiscal: string, lines: { desc: string; sku: string; total: number; discount?: number }[]): number {
  const r = db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, `sha-${fiscal}`);
  const id = Number(r.lastInsertRowid);
  lines.forEach((l, i) => {
    const it = db.prepare(`INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, qty_milli, unit, line_total_cents)
      VALUES (?, ?, ?, ?, 1000, 'un', ?)`).run(id, i + 1, l.desc, l.sku, l.total);
    if (l.discount) db.prepare(`INSERT INTO receipt_discounts (item_id, position, label, tag, amount_cents) VALUES (?, 1, 'MP', 'M', ?)`)
      .run(it.lastInsertRowid, l.discount);
  });
  matchReceipt(db, id);
  return id;
}
const product = (db: Db, name: string, category = "pantry", unit = "un") =>
  Number(db.prepare("INSERT INTO products (name, category, unit, created_at) VALUES (?, ?, ?, 'now')").run(name, category, unit).lastInsertRowid);

describe("reviewQueue", () => {
  it("lists auto-created products with what was seen and what was spent", () => {
    const db = openDb(":memory:");
    product(db, "Reviewed already");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 2195000, discount: -548750 }, { desc: "=PISI", sku: "0000012346", total: 2000000 }]);
    receipt(db, "2", [{ desc: "PISI", sku: "0000012345", total: 2195000 }]);
    expect(reviewQueue(db)).toEqual([{
      id: 2, name: "Pisi", category: "other", unit: "un",
      descriptions: ["=PISI", "PISI"], codes: ["0000012345", "0000012346"], timesBought: 3, totalSpentCents: 5841250,
    }]);
    expect(allProducts(db)).toEqual([{ id: 2, name: "Pisi" }, { id: 1, name: "Reviewed already" }]);
  });
});

describe("updateProduct", () => {
  it("renames, recategorises and clears the review flag", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 100 }]);
    updateProduct(db, 1, { name: "Sopa Pisi (sobre)", category: "pantry", unit: "un", needsReview: false });
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products").get())
      .toEqual({ name: "Sopa Pisi (sobre)", category: "pantry", unit: "un", needs_review: 0 });
    expect(reviewQueue(db)).toEqual([]);
  });
  it("rejects an empty name, an unknown category, or a name another product owns", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 100 }]);
    product(db, "Taken");
    expect(() => updateProduct(db, 1, { name: "  ", category: "pantry", unit: "un", needsReview: false })).toThrow(/name/);
    expect(() => updateProduct(db, 1, { name: "X", category: "snacks" as never, unit: "un", needsReview: false })).toThrow(/category/);
    expect(() => updateProduct(db, 1, { name: "Taken", category: "pantry", unit: "un", needsReview: false })).toThrow();
  });
});

describe("mergeProducts", () => {
  it("moves codes, rules and matches to the target and deletes the source", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "FELPITA", sku: "0000000001", total: 100 }, { desc: "ROLLO D/COCINA MAXIR", sku: "0000000002", total: 100 }]);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'FELPITA', 1)").run();
    mergeProducts(db, 1, 2);
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT DISTINCT product_id FROM product_codes").all()).toEqual([{ product_id: 2 }]);
    expect(db.prepare("SELECT product_id FROM product_rules").all()).toEqual([{ product_id: 2 }]);
    expect(db.prepare("SELECT DISTINCT product_id FROM product_matches").all()).toEqual([{ product_id: 2 }]);
  });
  it("refuses to merge a product into itself or into nothing", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "FELPITA", sku: "0000000001", total: 100 }]);
    expect(() => mergeProducts(db, 1, 1)).toThrow();
    expect(() => mergeProducts(db, 1, 99)).toThrow();
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 1 });
  });
});

describe("moveCode", () => {
  it("re-points one article code and the items that carry it", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "OREO", sku: "0000000001", total: 100 }, { desc: "OREO", sku: "0000000002", total: 100 }]);
    const cookies = product(db, "Galletitas Oreo (118 g)");
    moveCode(db, "coto", "0000000002", cookies);
    expect(db.prepare("SELECT sku, product_id FROM product_codes ORDER BY sku").all())
      .toEqual([{ sku: "0000000001", product_id: 1 }, { sku: "0000000002", product_id: cookies }]);
    expect(db.prepare(`SELECT i.position, m.product_id, m.method FROM product_matches m JOIN receipt_items i ON i.id = m.item_id ORDER BY i.position`).all())
      .toEqual([{ position: 1, product_id: 1, method: "auto" }, { position: 2, product_id: cookies, method: "code" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/products.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/products`.

- [ ] **Step 3: Write the library**

```ts
// web/src/lib/receipts/products.ts
import type Database from "better-sqlite3";
import { isProductCategory, type ProductCategory } from "./categories";

export type ReviewProduct = {
  id: number; name: string; category: ProductCategory; unit: "un" | "kg";
  descriptions: string[]; codes: string[]; timesBought: number; totalSpentCents: number;
};
export type ProductOption = { id: number; name: string };

/** Products the matcher invented, with the evidence a reviewer needs to name and file them. */
export function reviewQueue(db: Database.Database): ReviewProduct[] {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit,
           (SELECT COUNT(*) FROM product_matches m WHERE m.product_id = p.id) AS timesBought,
           (SELECT COALESCE(SUM(i.line_total_cents + COALESCE((SELECT SUM(d.amount_cents) FROM receipt_discounts d WHERE d.item_id = i.id), 0)), 0)
              FROM product_matches m JOIN receipt_items i ON i.id = m.item_id WHERE m.product_id = p.id) AS totalSpentCents
    FROM products p WHERE p.needs_review = 1 ORDER BY totalSpentCents DESC, p.name`).all() as Omit<ReviewProduct, "descriptions" | "codes">[];
  const descs = db.prepare(`
    SELECT DISTINCT i.desc_printed FROM product_matches m JOIN receipt_items i ON i.id = m.item_id
    WHERE m.product_id = ? ORDER BY i.desc_printed`);
  const codes = db.prepare("SELECT sku FROM product_codes WHERE product_id = ? ORDER BY sku");
  return rows.map(r => ({
    ...r,
    descriptions: (descs.all(r.id) as { desc_printed: string }[]).map(d => d.desc_printed),
    codes: (codes.all(r.id) as { sku: string }[]).map(c => c.sku),
  }));
}

export function allProducts(db: Database.Database): ProductOption[] {
  return db.prepare("SELECT id, name FROM products ORDER BY name").all() as ProductOption[];
}

export function updateProduct(
  db: Database.Database, id: number,
  patch: { name: string; category: ProductCategory; unit: "un" | "kg"; needsReview: boolean },
): void {
  const name = patch.name.trim();
  if (!name) throw new Error("product name is required");
  if (!isProductCategory(patch.category)) throw new Error(`unknown category "${patch.category}"`);
  if (patch.unit !== "un" && patch.unit !== "kg") throw new Error(`unknown unit "${patch.unit}"`);
  // The UNIQUE constraint on name is the guard against a duplicate; SQLite throws, the action reports.
  const r = db.prepare("UPDATE products SET name = ?, category = ?, unit = ?, needs_review = ? WHERE id = ?")
    .run(name, patch.category, patch.unit, patch.needsReview ? 1 : 0, id);
  if (r.changes === 0) throw new Error(`no product ${id}`);
}

/** Everything that pointed at `sourceId` now points at `targetId`; the source row goes. */
export function mergeProducts(db: Database.Database, sourceId: number, targetId: number): void {
  if (sourceId === targetId) throw new Error("cannot merge a product into itself");
  const run = db.transaction(() => {
    const target = db.prepare("SELECT id FROM products WHERE id = ?").get(targetId);
    if (!target) throw new Error(`no product ${targetId}`);
    db.prepare("UPDATE product_codes SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE product_rules SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE product_matches SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    const r = db.prepare("DELETE FROM products WHERE id = ?").run(sourceId);
    if (r.changes === 0) throw new Error(`no product ${sourceId}`);
  });
  run();
}

/** One article code was filed under the wrong product: move it, and every item that carries it. */
export function moveCode(db: Database.Database, chain: string, sku: string, targetId: number): void {
  const run = db.transaction(() => {
    const r = db.prepare("UPDATE product_codes SET product_id = ? WHERE chain = ? AND sku = ?").run(targetId, chain, sku);
    if (r.changes === 0) throw new Error(`no code ${chain}/${sku}`);
    db.prepare(`
      UPDATE product_matches SET product_id = ?, method = 'code'
      WHERE item_id IN (SELECT i.id FROM receipt_items i JOIN receipts rc ON rc.id = i.receipt_id WHERE rc.chain = ? AND i.sku = ?)`)
      .run(targetId, chain, sku);
  });
  run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/products.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Dictionary keys and chrome**

`en`:

```ts
  "super.review.summary": "{count} products were created from receipt lines and wait for a name and a category.",
  "super.review.none": "Nothing to review: every receipt line has a named product.",
  "super.review.seen": "Seen as",
  "super.review.codes": "Codes",
  "super.review.lines": "{count} lines · {total}",
  "super.review.name": "Name",
  "super.review.category": "Category",
  "super.review.unit": "Unit",
  "super.unit.un": "unit",
  "super.unit.kg": "kg",
  "super.review.save": "Save",
  "super.review.mergeInto": "Or merge into",
  "super.review.merge": "Merge",
  "super.review.footer": "This page lists the products the reader had to invent: a receipt line whose article code and description matched nothing known. Give each one its real name, its department and its unit and save it; from then on every receipt with that code lands on it. If it is a product that already exists under another name, merge it instead: its codes and its lines move over and the invented one disappears.",
```

`es`:

```ts
  "super.review.summary": "{count} productos se crearon a partir de líneas de tickets y esperan un nombre y una categoría.",
  "super.review.none": "Nada que revisar: cada línea de ticket tiene un producto con nombre.",
  "super.review.seen": "Visto como",
  "super.review.codes": "Códigos",
  "super.review.lines": "{count} líneas · {total}",
  "super.review.name": "Nombre",
  "super.review.category": "Categoría",
  "super.review.unit": "Unidad",
  "super.unit.un": "unidad",
  "super.unit.kg": "kg",
  "super.review.save": "Guardar",
  "super.review.mergeInto": "O unir con",
  "super.review.merge": "Unir",
  "super.review.footer": "Esta página lista los productos que el lector tuvo que inventar: una línea de ticket cuyo código de artículo y descripción no coincidían con nada conocido. Dale a cada uno su nombre real, su rubro y su unidad y guardalo; desde entonces cada ticket con ese código cae ahí. Si es un producto que ya existe con otro nombre, unilo en cambio: sus códigos y sus líneas se mudan y el inventado desaparece.",
```

In `web/src/lib/chrome.ts`, add `"/super/review": { title: "super.review.title" },` beside the other `/super` entries.

- [ ] **Step 6: The server actions**

```ts
// web/src/app/super/review/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { isProductCategory } from "@/lib/receipts/categories";
import { updateProduct, mergeProducts, moveCode } from "@/lib/receipts/products";

// Product edits change what every /super page shows and what the receipt detail names, so the
// whole tree is revalidated. Bad input is ignored, as the charge actions do: the form re-renders
// with the row still in the queue, which is the only feedback a wrong select can deserve.
export async function saveProductAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "");
  const category = String(formData.get("category") ?? "");
  const unit = String(formData.get("unit") ?? "");
  if (!Number.isInteger(id) || !name.trim() || !isProductCategory(category) || (unit !== "un" && unit !== "kg")) return;
  updateProduct(getDb(), id, { name, category, unit, needsReview: false });
  revalidatePath("/", "layout");
}

export async function mergeProductAction(formData: FormData): Promise<void> {
  const source = Number(formData.get("source"));
  const target = Number(formData.get("target"));
  if (!Number.isInteger(source) || !Number.isInteger(target) || source === target) return;
  mergeProducts(getDb(), source, target);
  revalidatePath("/", "layout");
}

export async function moveCodeAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  const target = Number(formData.get("target"));
  if (!/^\d{10}$/.test(sku) || !Number.isInteger(target)) return;
  moveCode(getDb(), "coto", sku, target);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 7: The page**

Plain forms bound to server actions; no client component needed.

```tsx
// web/src/app/super/review/page.tsx
import { getDb } from "@/lib/db";
import { reviewQueue, allProducts } from "@/lib/receipts/products";
import { PRODUCT_CATEGORIES } from "@/lib/receipts/categories";
import { fmtArsCents } from "@/lib/receipts/money";
import { getT } from "@/lib/locale";
import { saveProductAction, mergeProductAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SuperReview() {
  const tr = await getT();
  const db = getDb();
  const queue = reviewQueue(db);
  const options = allProducts(db);
  const field = "mt-0.5 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink";
  const button = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90";
  return (
    <main>
      <p className="mb-4 text-sm text-ink-muted">
        {queue.length === 0 ? tr("super.review.none") : tr("super.review.summary", { count: queue.length })}
      </p>
      <div className="space-y-4">
        {queue.map(p => (
          <div key={p.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-ink-muted">{tr("super.review.lines", { count: p.timesBought, total: fmtArsCents(p.totalSpentCents) })}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 text-xs text-ink-muted">
              <dt>{tr("super.review.seen")}</dt><dd className="font-mono">{p.descriptions.join(" · ")}</dd>
              <dt>{tr("super.review.codes")}</dt><dd className="font-mono">{p.codes.join(" · ") || "—"}</dd>
            </dl>
            <form action={saveProductAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_6rem_auto] sm:items-end">
              <input type="hidden" name="id" value={p.id} />
              <label className="text-xs text-ink-muted">{tr("super.review.name")}
                <input name="name" defaultValue={p.name} required className={field} />
              </label>
              <label className="text-xs text-ink-muted">{tr("super.review.category")}
                <select name="category" defaultValue={p.category} className={field}>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{tr(`productCategory.${c}`)}</option>)}
                </select>
              </label>
              <label className="text-xs text-ink-muted">{tr("super.review.unit")}
                <select name="unit" defaultValue={p.unit} className={field}>
                  <option value="un">{tr("super.unit.un")}</option>
                  <option value="kg">{tr("super.unit.kg")}</option>
                </select>
              </label>
              <button type="submit" className={button}>{tr("super.review.save")}</button>
            </form>
            <form action={mergeProductAction} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="source" value={p.id} />
              <label className="min-w-64 text-xs text-ink-muted">{tr("super.review.mergeInto")}
                <select name="target" className={field}>
                  {options.filter(o => o.id !== p.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
                {tr("super.review.merge")}
              </button>
            </form>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.review.footer")}</p>
    </main>
  );
}
```

`moveCodeAction` has no form on this page yet: it exists for the products page's future per-code control and is exercised by the library test. Leave it exported.

- [ ] **Step 8: Run the gates, try it**

Run: `npx tsc --noEmit && npx vitest run` — all green: `chrome.test.ts` now sees four `/super*` routes with four entries.

Browser: upload a receipt whose line the seed does not know (any new receipt will do; or temporarily rename a rule) and open `/super/review`: the invented product shows its descriptions and codes. Rename it, pick a category, Save: it leaves the queue, and `/super/categories` moves its spend out of "other". Merge another one into an existing product: the queue shrinks, `/super/products` shows the merged product with the summed times bought.

- [ ] **Step 9: Commit**

```bash
git add src/lib/receipts/products.ts src/lib/receipts/products.test.ts src/app/super/review src/lib/chrome.ts src/lib/i18n.ts
git commit -m "feat(super): review queue — name, file or merge the products the matcher invented"
```

---

### Task 9: Documentation

**Files:**
- Modify: `web/README.md` (the "Supermarket receipts" section from P1)

- [ ] **Step 1: Document products and analytics**

Append to the "Supermarket receipts" section of `web/README.md`:

```markdown
**Products.** Every receipt line is matched to a canonical product at ingest: by Coto article
code first (`product_codes`), then by an ordered description rule (`product_rules`), else a
product is created flagged for review (`/super/review`). The starting set comes from
`data/products-seed.json`, loaded once into an empty `products` table; it was built from the
prototype's `master.json` and the recorded transcripts with

```bash
npm run build-products-seed -- ~/Desktop/Super/analisis/datos/master.json
```

and is not rebuilt automatically. `/super`, `/super/products` and `/super/categories` compute
everything on read from `receipts`, `receipt_items` and `product_matches`; nothing derived is stored.
`src/lib/receipts/analytics.replay.test.ts` replays the five recorded receipts and checks the
numbers against the prototype's `master.json`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: supermarket products, seed and analytics"
```

---

## Self-review

**Spec coverage (§13 and §8 of `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`):**

| Spec | Task |
|---|---|
| §2 d3 code-first product identity | 2, 4 |
| §2 d9 seed from `master.json`, codes learned from the acceptance run | 3 |
| §2 d10 analytics computed on read | 5, 7 |
| §2 d19 twelve category keys, code constant, i18n labels, colours | 1 |
| §2 d20 auto-create flagged product, review queue | 4, 8 |
| §2 d21 three RSC pages with the Recharts wrappers | 6, 7 |
| §13.1 four tables | 2 |
| §13.2 matching order, code learning, product-level corrections | 4, 8 |
| §13.3 seed shape and builder | 3 |
| §13.4 every analysis; verified against the prototype | 5 |
| §13.5 pages, nav group order | 7, 8 |
| §8 analyses 1–10 | 5 (periods, kpis, products, appearances, categories, index, savings split, frequency, basket, top) |
| §8 unit prices derived, never printed | 5 (`unitGross = gross / qty`) |

**Placeholder scan:** no "TBD", "TODO", "similar to Task N", or "add validation"; every step with code shows the code.

**Type consistency:** `ProductCategory` (Task 1) is the type used by `ItemFact`, `ProductStat`, `CategoryStat`, `ReviewProduct`, `updateProduct` and the seed. `ReceiptFact`/`ItemFact` (Task 5 `facts.ts`) are what `buildAnalytics` takes and what both analytics tests construct. `MatchReport` is returned by `matchReceipt` and `rematchAll` alike. `storeReceipt`'s input shape in the replay test is P1's `StoreInput`. The chart props (`SpendPoint`, `IndexChartPoint`, `SavingsPoint`) are built in Task 7 from `Period` and `IndexPoint` fields by name. `reviewQueue`'s row shape is what the review page reads.

**Out of scope, on purpose:** per-code "move" control on the products page (`moveCodeAction` exists, no form yet); official CPI comparison; unit-size normalisation; promo-efficiency; P3 charge links.
