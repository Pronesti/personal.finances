# Supermarket receipts — specification

Consolidates `~/Desktop/Super/analisis/PROJECT.md` (the standalone prototype) with every decision
taken on 2026-09-04 for integrating the pipeline into the Tarjetas web app. Three plans implement
it, each shipping working software on its own:

- **P1 — ingest** (`docs/superpowers/plans/2026-09-04-supermarket-receipts-p1-ingest.md`): upload a
  receipt PDF, OCR it locally, parse, reconcile to the cent, store, dedupe, show a reconciliation
  report. Acceptance suite over the five existing receipts.
- **P2 — products and analytics**: canonical products keyed by Coto article code, normalization
  rules as data, review queue, the analyses of §7 as pages.
- **P3 — charge reconciliation** (`docs/superpowers/plans/2026-09-04-supermarket-receipts-p3-charge-links.md`): link each receipt to the card charge that paid it (§9).

## 1. Purpose

Weekly Coto receipts become a verified, structured dataset: spend per receipt and per category,
a personal price index over the products actually bought (list price and effective price after
promotions), savings by promotion type (Mercado Pago vs Coto shelf offers), purchase habits, and
basket changes. Every receipt must reconcile exactly against the totals printed on it before it
enters the dataset.

## 2. Decisions (2026-09-04)

| # | Decision | Choice |
|---|---|---|
| 1 | OCR engine | Apple Vision, local, via `scripts/ocr_receipt.py` (pyobjc) in the existing `.venv`. macOS only. No cloud, no key. tesseract measured unusable (4/21 line totals); Vision read 21/21 and 26/26 line totals on the two receipts tested. |
| 2 | Extraction shape | Two stages. OCR yields text boxes; Node groups them into rows and a deterministic parser builds the receipt. No LLM. |
| 3 | Product identity | Every item line prints `<10-digit article code> <EAN>`. Both captured. P2 matches products by code first, description rules second. |
| 4 | Identity and dedup | Two unique keys per receipt: `fiscal_number` (NRO.T., read from the header) and `file_sha256`. Duplicate on either is rejected with a link to the existing receipt. The Coto QR is not read (dropped 2026-09-04: not important). |
| 5 | Verification failure | Nothing is stored. The response carries the report and the OCR rows as editable text; the user corrects digits and re-verifies (`POST /api/receipts/corrected`). The PDF waits in `pdfs/receipts/.pending/<sha>.pdf`. |
| 6 | Time axis | A period is a receipt, ordered by date and time. "Week N" is a display index. No calendar-week bucketing. |
| 7 | PDF → images | Pure Node: `mupdf` (WASM) renders each page to PNG at the OCR scale. No other image library. |
| 8 | Retention | Original PDF kept at `pdfs/receipts/<sha256>.pdf`. OCR rows text kept in `receipt_transcripts`. Page PNGs are temporary. |
| 9 | Reference data seed (P2) | Products, categories, units and description→product rules seeded from the prototype's `master.json`. Article-code map learned from the acceptance run. |
| 10 | Derived analytics | Computed on read from `receipts` + `receipt_items` + product matches. No materialized tables. |
| 11 | Money and quantity | `INTEGER` cents and `INTEGER` thousandths (1.285 kg → 1285; 4 units → 4000). Exact integer arithmetic in the gate. |
| 12 | Discounts | One row per printed discount line: label, tag (`M` Mercado Pago, `A` Coto), amount. Promo type derived: only M, only A, both = mixed. |
| 13 | Upload UX | Synchronous request. Status is implicit in the response (stored / rejected / error). |
| 14 | Acceptance suite | `npm run test:receipts`, gated by `RECEIPT_ACCEPTANCE=1`, macOS only. Five PDFs in `pdfs/receipts-acceptance/`, expected JSON copied from the prototype. Offline unit tests use recorded rows text. |
| 15 | Schema mechanics | New `CREATE TABLE IF NOT EXISTS` block in `migrate()` (`web/src/lib/db.ts`), same as every other table. |
| 16 | Module layout | `web/src/lib/receipts/` with one file per stage. Tests colocated. |
| 17 | Routes | `/receipts` (list + upload), `/receipts/[id]` (detail + report). Nav group "Supermarket". `POST /api/receipts`, `POST /api/receipts/corrected`. |
| 18 | Charge link (P3) | `transactions.fingerprint` (stable hash) + `receipt_charge_links`. Auto-match on supermarket charge, date within ±3 days, `ars == total` or `ars × installment_count == total`. |
| 19 | Product categories (P2) | Keys with i18n labels: `produce, meat_fish, dairy, deli, pantry, bakery, prepared, beverages, cleaning, personal_care, pets, other`. A code constant like the 12 charge categories (`categorize.ts`), not a table. Separate taxonomy. |
| 20 | Unmatched code (P2) | Auto-create the product from the title-cased description, category `other`, `needs_review = 1`; a queue page fixes it. |
| 21 | Dashboard (P2) | Three RSC pages with the existing Recharts wrappers: `/super`, `/super/products`, `/super/categories`. |

Assumptions stated, not asked:

- The per-offer breakdown ("DETALLE DE OFERTAS APLICADAS") is cross-checked and reported, but a
  mismatch there is a **warning**, not a rejection. That section is the least reliable part of
  the scan (amounts print offset by a row) and the three totals already pin every cent.
- Upload cap 40 MB (the largest existing receipt is 17.7 MB).
- Only the Coto chain is recognised. `chain` is a column so a second chain is data, not a schema change.
- The file name is never read. Not for the date, not for dedup, not for storage (the stored name is the hash).

## 3. Pipeline (P1)

1. **Upload** — `POST /api/receipts`, multipart `file`. Checks: `%PDF-` magic, size ≤ 40 MB, sha256 not already stored.
2. **Render** — `mupdf` renders every page to PNG at the OCR scale.
3. **OCR** — `scripts/ocr_receipt.py` (Apple Vision, accurate, no language correction, `es-ES` + `en-US`) prints one JSON box per line: `{page, x, y, w, h, text}` in image fractions, origin top-left.
4. **Rows** — boxes grouped into rows by vertical centre (tolerance 0.6 × median box height). The rightmost amount-shaped box at `x ≥ 0.5` is the row's amount; the rest, left to right, is the label. Rows serialise to text (`label<TAB>amount`, `## page N` separators) — the transcript the user can edit.
5. **Merge pages** — pages overlap. Code lines (`\d{10} \d{12,14}`) are anchors: the longest run of codes ending page k that equals the run starting page k+1 is dropped from page k+1, and the last duplicated item keeps whichever copy has more discount rows.
6. **Parse** — state machine over rows (§5).
7. **Verify** — exact-cent gate (§6). On failure, retry OCR at the next scale (3× → 2× → 1.5×); the first scale that reconciles wins; if none does, the attempt with the fewest failing checks is returned for correction.
8. **Store** — one transaction: `receipts`, `receipt_items`, `receipt_discounts`, `receipt_transcripts`; PDF written to `pdfs/receipts/<sha>.pdf`.

## 4. Data model (P1)

```sql
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY,
  chain TEXT NOT NULL,                     -- 'coto'
  branch_code TEXT,                        -- '090'
  branch_name TEXT,                        -- 'SUC 90 COTO CICSA'
  date TEXT NOT NULL,                      -- ISO, as printed on the receipt
  time TEXT,                               -- 'HH:MM:SS', as printed
  fiscal_number TEXT NOT NULL UNIQUE,      -- NRO.T., e.g. '2090-06514979'
  file_sha256 TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  register TEXT, terminal TEXT, trx TEXT,
  cae TEXT, cae_due TEXT,
  payment_method TEXT, payment_ref TEXT,
  subtotal_cents INTEGER NOT NULL,         -- SUBTOT. SIN DESCUENTOS
  discounts_cents INTEGER NOT NULL,        -- DESCUENTOS POR PROMOCIONES, <= 0
  total_cents INTEGER NOT NULL,            -- TOTAL
  header_json TEXT NOT NULL,               -- every other header/footer fact read
  verification_json TEXT NOT NULL,         -- the report, as returned to the client
  transcript_source TEXT NOT NULL CHECK (transcript_source IN ('ocr','corrected')),
  ocr_scale REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipt_items (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,               -- printed order, 1-based
  desc_printed TEXT NOT NULL,              -- verbatim, '=' prefix kept
  no_promo INTEGER NOT NULL DEFAULT 0,     -- the '=' prefix
  sku TEXT, ean TEXT,
  qty_milli INTEGER NOT NULL,              -- thousandths: kg or units
  unit TEXT NOT NULL CHECK (unit IN ('un','kg')),
  unit_price_cents INTEGER,                -- as printed; NULL when qty is 1 and nothing printed
  line_total_cents INTEGER NOT NULL,
  UNIQUE (receipt_id, position)
);
CREATE TABLE IF NOT EXISTS receipt_discounts (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,                     -- 'MERCADO PAGO 25% - V', '1 *30% ELABORADOS'
  tag TEXT NOT NULL CHECK (tag IN ('M','A')),
  amount_cents INTEGER NOT NULL            -- < 0
);
CREATE TABLE IF NOT EXISTS receipt_transcripts (
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ocr','corrected')),
  text TEXT NOT NULL,
  PRIMARY KEY (receipt_id, kind)
);
```

P2 adds `products`, `product_codes`, `product_rules`, `product_matches` (§13). P3 adds
`transactions.fingerprint` and `receipt_charge_links`.

## 5. Receipt layout and parsing rules

Coto thermal print, as scanned (see `~/Desktop/Super/*.pdf`):

```
SUC 90 COTO CICSA
SEGUROLA 1743 / MONTE CASTRO / CUIT:30-54808315-6 ...
04/09/2026 09:42:15            NRO.T.:2090-06514979
NRO.CAJA:0012   NRO.TERM:3791  NRO.TRAN:4969
FACTURA B / ORIGINAL (Cod.006)
    0,172 x 25899,00                      <- quantity line, only when qty != 1 (kg with 3 decimals, units as "4,000")
VERDURAS GRILLADAS COTOX KG               <- description, verbatim; leading '=' = no promotion applies
0000038072 02538072001727      4454,63    <- article code, EAN, line total (list price × qty)
1 *30% ELABORADOS      [A]    -1336,39    <- 0..n discount lines; [A] Coto offer, [M] Mercado Pago
...
SUBTOT. SIN DESCUENTOS        146931,91
DESCUENTOS POR PROMOCIONES    -37203,57
TOTAL                         109728,34
MERCADO PAG 177204174592      109728,34   <- payment method + reference
ART:040 TRX:4969 EMP:123859-SORIA
DETALLE DE OFERTAS APLICADAS              <- per-offer totals; amounts print offset by one row
1 *30% ELABORADOS              1336,39
...
TOT.AHORRO                    37203,57
C.A.E.Nro.:86361418114640  Vto.:20260914
<Coto QR>  <ARCA QR>                      <- not read
```

Rules the parser implements:

- Amounts: no thousands separator on receipts; decimal comma; two decimals. OCR spaces inside a
  number are removed before parsing. `1.234,56` is also accepted.
- Quantity line: `^\d+,\d{3} [x×х] amount$` (Vision emits Cyrillic `х` for the multiplication sign
  at times). Applies to the next code line. Absent → qty 1000 (one unit), unit price NULL.
- Unit: `kg` when qty is not a whole number of units or the description ends in `X KG`, `XKG`, `KGM`; else `un`.
- Code line: `^\d{10} \d{12,14}$`. Creates the item; its description is the last unclassified
  label row above it. The line total is on the code row, or on the description row (Vision
  sometimes groups the large-font amount there), or on the next amount-only row.
- Discount line: label ending in a tag `[A]`/`[M]` (OCR variants `LA]`, `(M)` accepted) with an amount. Attached to the open item. Amount forced negative.
- `=` prefix: kept in `desc_printed`; `no_promo = 1`. OCR reads it as `-` or `−` at times; normalised to `=`.
- Printer glyph `?` stands for `ñ`/`°` (`PA?UELOS`, `N?34`). Kept as read.
- Header facts are searched on every row (the CAE is in the footer). First match wins.
- Offers section: labels and amounts collected in order between `DETALLE DE OFERTAS` and
  `TOT.AHORRO`, then paired by index — that is what survives the row offset in the scan.
- The offer counter (`3` in `3 *25% MARCAS`) counts applications across the receipt, not the item's quantity.

## 6. Verification gate and report

Hard checks (all must hold, integers in cents):

1. `Σ line_total_cents == subtotal_cents` (SUBTOT. SIN DESCUENTOS)
2. `Σ discount amount_cents == discounts_cents` (DESCUENTOS POR PROMOCIONES)
3. `subtotal_cents + discounts_cents == total_cents` (TOTAL)

Errors (also reject): date not read, NRO.T. not read, no items, an item without a line total, a
printed total missing.

Warnings (reported, never reject): `TOT.AHORRO ≠ −discounts`; item where
`round(qty_milli × unit_price_cents / 1000)` differs from `line_total_cents` by more than 1 cent
(unit price misread — analytics derive unit prices from `line_total / qty` anyway); offer whose
printed amount differs from the sum of the matching discount lines; parser notes.

Report shape (stored in `verification_json`, returned by the API):

```ts
type Check = { name: "subtotal" | "discounts" | "total"; computed: number; printed: number | null; ok: boolean };
type VerificationReport = {
  ok: boolean;
  checks: Check[];
  offers: { label: string; printed: number | null; computed: number | null; ok: boolean }[];
  warnings: string[];
  errors: string[];
};
```

## 7. Failure and correction flow

`POST /api/receipts` on failure answers `422` with
`{ code: "verification_failed", message, report, rowsText, sha256, scale }` and keeps the PDF at
`pdfs/receipts/.pending/<sha>.pdf` plus the rows at `.pending/<sha>.rows.txt`. The page shows the
checks, the errors, and a textarea with `rowsText`. `POST /api/receipts/corrected` with
`{ sha256, rowsText }` re-parses the text, verifies, and stores with
`transcript_source = 'corrected'`, keeping both transcripts. Pending files are deleted on success;
leftovers are harmless and gitignored.

Rows text format: one row per line, `label<TAB>amount`; an amount alone starts with a tab; a
line `## page N` starts a page. When re-reading, a tab or two or more spaces before an
amount-shaped tail both count as the separator, so the textarea needs no tab key.

## 8. Analyses (P2, from the prototype, unchanged)

All computed on read from stored rows, in receipt order:

1. Per-receipt summary: items, gross, discounts, total, savings %, split M / A / mixed.
2. KPIs: last receipt vs previous, average per receipt, monthly projection (average × 4.33), accumulated spend and savings.
3. Price change per repeated product between its last two appearances, list and effective, quantity-weighted within a receipt.
4. Full price trajectories per repeated product.
5. Net spend per category per receipt; totals; share; discounts captured.
6. Chained personal price index, base 100 at the first receipt: chain factor for receipt w is `Σ(qty_w × price_w) / Σ(qty_w × price_prev)` over products with a previous appearance; two series (list, effective).
7. Savings by promo type per receipt and accumulated.
8. Purchase frequency: times bought / receipts; essentials (every receipt), frequent, occasional.
9. Basket changes between the last two receipts.
10. Top products by spend.

Unit prices for analytics derive from `line_total_cents / qty_milli`, never from the printed
unit price (which OCR may misread; the line total is what reconciles).

## 9. Charge reconciliation (P3)

Facts from the live data: the 2026-08-07 receipt (115370.80) is a `visa` charge `MERPAGO*COTO`
of 115370.8 on the same date; the 2026-08-14 receipt (84288.50) is a `mercadopago` charge of
42144.25, installment 1 of 2. Descriptions carry no reference number; the MP voucher is not stored.

- `transactions.fingerprint = sha1(brand|date|description|ars|installment_number|installment_count)`, computed at ingest, stable across re-ingest.
- `receipt_charge_links (receipt_id UNIQUE, fingerprint UNIQUE, state CHECK IN ('matched','pending','unmatched'), method CHECK IN ('auto','manual'))`.
- Candidate charge: `subcategory = 'supermarket'`, `section = 'purchases'`, date within ±3 days of the receipt, and `round(ars × 100) == total_cents` or `round(ars × installment_count × 100) == total_cents`.
- One candidate → `matched/auto`; several → `pending`; none → `unmatched`. Manual link/unlink always allowed. Reconciliation never edits either side.
- Supermarket charges with no receipt are listed: the completeness check receipts alone cannot give.

## 10. UI (P1)

- Nav group **Supermarket / Súper** → `/receipts`.
- `/receipts`: drop zone (one PDF at a time), result panel (stored → link; rejected → checks, errors, textarea, "Verify again"), table of receipts (date, time, branch, items, subtotal, discounts, total, saved %, source), plain-language footer like every other page.
- `/receipts/[id]`: receipt facts (ticket number, register, terminal, payment, CAE, file hash), verification report (checks with ✓/✗, offers table, warnings), items table (position, description, code, qty, unit price, line total, discount lines, net), transcript in a collapsed block.
- Copy in both dictionaries of `web/src/lib/i18n.ts`; English default. Numbers in Argentine format. Pages render no `<h1>`; titles come from `CHROME`.

## 11. Acceptance suite (P1)

- Five PDFs copied to `pdfs/receipts-acceptance/` (gitignored). Override with `TARJETAS_RECEIPT_ACCEPTANCE_DIR`.
- Expected JSON copied from `~/Desktop/Super/analisis/datos/week{1..5}_raw.json` to `web/src/lib/receipts/__fixtures__/expected/<date>.json`. Receipts are matched to expectations by the **printed date**, never by file name.
- Per receipt: report `ok`; item count equal; per item in order: `qty`, `unit_price`, `line_total`, `discount` (sum) exact; `desc` similarity ≥ 0.9 after uppercasing, collapsing spaces, dropping the `=` prefix, and treating the expected `?` as a wildcard; tags `[M]`/`[A]` in `discount_desc` present iff a discount line with that tag exists; `sku` and `ean` non-null.
- `RECEIPT_RECORD=1` writes each receipt's rows text to `__fixtures__/rows/<date>.rows.txt`; the offline parser test replays every recorded file and asserts the gate passes and the totals match the expected JSON.

## 12. Setup

```bash
# repo root
.venv/bin/pip install -r requirements.txt        # adds pyobjc Vision + Quartz (macOS)
cd web && npm install                             # adds mupdf
```

`resolvePython()` (`web/src/lib/upload.ts`) is reused: `.venv/bin/python3` or `TARJETAS_PYTHON`.
`TARJETAS_OCR_SCRIPT` overrides the script path (tests). `TARJETAS_RECEIPT_DIR` overrides
`pdfs/receipts`.

## 13. Products and analytics (P2)

Plan: `docs/superpowers/plans/2026-09-04-supermarket-receipts-p2-products-analytics.md`.

### 13.1 Data model

```sql
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,               -- canonical, e.g. 'Banana Cavendish (por kg)'
  category TEXT NOT NULL,                  -- one of the 12 product category keys (code constant)
  unit TEXT NOT NULL CHECK (unit IN ('un','kg')),
  needs_review INTEGER NOT NULL DEFAULT 0, -- 1 when auto-created from a description
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_codes (   -- the article code IS the product identity
  chain TEXT NOT NULL,
  sku TEXT NOT NULL,
  ean TEXT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (chain, sku)
);
CREATE TABLE IF NOT EXISTS product_rules (   -- fallback for a code never seen: substring of the description
  position INTEGER NOT NULL PRIMARY KEY,     -- first match wins, so order is data
  chain TEXT NOT NULL,
  match TEXT NOT NULL,                       -- uppercase; '?' is a one-character wildcard (printer glyph)
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE (chain, match)
);
CREATE TABLE IF NOT EXISTS product_matches (  -- one row per receipt item, written at ingest
  item_id INTEGER PRIMARY KEY REFERENCES receipt_items(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('code','rule','auto'))
);
```

### 13.2 Matching (runs at the end of `storeReceipt`, and on demand for every receipt)

For each item of the receipt, in printed order:

1. `product_codes (chain, sku)` → product, method `code`.
2. Else the first `product_rules` row of the chain, by position, whose `match` (with `?` as any
   one character) is a substring of the description (uppercased, `=` prefix dropped) → product,
   method `rule`. The code is then learned: `product_codes` gains `(chain, sku, ean, product)`.
3. Else a product is created: name = title-cased description, category `other`, unit = the
   item's unit, `needs_review = 1`; the code is learned; method `auto`. A later item with the same
   description reuses that product by name.

Corrections happen at the product level on `/super/review`: rename, set category and unit,
merge into another product (codes, rules and matches move; the source row goes), move one
article code to another product (its items follow). Nothing at the item level.

### 13.3 Seed (decision 9)

`data/products-seed.json` = `{ products: [{ name, category, unit }], codes: [{ chain, sku, ean, product }], rules: [{ match, product }] }`,
generated once by `web/scripts/build-products-seed.ts` from the prototype's `master.json`
(canonical name, category, unit per printed description) paired with the recorded OCR
transcripts of the same five receipts (article code and description as actually read, item by
item, matched by receipt date and position). Loaded by `migrate()` when `products` is empty,
the same way merchant rules were seeded. Tracked in git; `app.db` is not.

### 13.4 Analytics (decision 10: computed on read)

`loadFacts(db)` returns receipts and matched items (one row per item with its product, category,
qty, gross, discount sum, and which tags its discount lines carry). `buildAnalytics(receipts, items)`
is a pure function producing, in receipt order (period 1..n):

- `periods[]`: items, gross, discounts, total, savings %, and the split `mp` / `coto` / `mixed`
  (an item's whole discount goes to `mixed` when its lines carry both tags).
- `kpis`: last total and delta vs previous, average per receipt, monthly projection (× 4.33),
  accumulated total and savings.
- `products[]`: appearances per period (qty, gross, discount, net, unit gross, unit net — unit
  prices derived as gross/qty and net/qty, quantity-weighted when a product repeats within one
  receipt), times bought, total spent, and the change between the last two appearances (gross
  and net %).
- `categories[]`: net per period, total net, total discount, share.
- `index[]`: base 100 at period 1; factor for period p = Σ(qty_p × unit_p) / Σ(qty_p × unit_prev)
  over products bought in p with an earlier appearance, unit_prev being that product's unit
  price at its most recent earlier appearance; two series (list = gross, effective = net).
  Verified against the prototype: 104.27 / 100.29, 103.24 / 99.57, 108.89 / 102.76, 106.92 / 102.00.
- `frequency`: essentials (every period, n ≥ 2), frequent (≥ 2), occasional (1).
- `basket`: products that entered and left between the last two periods, with net amounts.
- `top`: 15 products by total spent.

The prototype's `master.json` is the fixture: replaying the five recorded transcripts through
ingest + seed + matching + analytics must reproduce its periods, split, index series and
category totals, and must create no `auto` product.

### 13.5 Pages

- `/super` — Stat tiles (last receipt with delta, average, monthly projection, accumulated
  savings); paid + discounts per receipt (stacked bars, one axis); index list vs effective
  (two lines); savings by promo type per receipt (stacked bars).
- `/super/products` — repeated products: last change (gross, net), times bought, unit-price
  sparkline; top products by spend; habits (essentials / frequent / occasional); basket
  changes between the last two receipts.
- `/super/categories` — net per category per receipt as a single-hue heatmap table with totals,
  share and discounts.
- `/super/review` — products with `needs_review = 1`: descriptions and codes seen, times
  bought; forms to rename, set category and unit, mark reviewed, merge into another product.
- Nav group "Supermarket": Overview, Products, Categories, Receipts, Review.
