# Credit Card Statement Analysis — App Reference

Reference document for building a personal financial analysis app from Visa/Mastercard statement JSONs. Decisions settled via design interview 2026-08-25.

## 1. Goal & Principles

- **ELI5 first look**: one screen, no scroll, ~6 tiles. Answers "how am I doing?" in 5 seconds.
- **Drill deep**: every tile clickable into full historical/future views, down to transaction level.
- **Real-terms honesty**: high-inflation ARS context — nominal comparisons are lies. Default view is CPI-adjusted constant pesos; toggles for nominal ARS and USD (MEP).
- **Honest uncertainty**: future projections displayed in 3 visually distinct layers — certain / expected / estimated.
- **Privacy**: amounts, dates, account numbers never leave the machine. Only raw merchant strings sent to LLM for categorization.

## 2. Data Inventory

- **Source**: 27 statement JSONs (`json/`), Jan 2025 → Jul 2026, ~1,341 transactions. Produced by `scripts/pdf_to_json.py` from bank PDFs (`pdfs/`).
- **Cards**: Visa Signature + Mastercard, single cardholder, same bank.
- **Per-file structure**: `file, brand, product, account, cardholder, period (closing/due dates, prev/next), balances (ARS+USD, minimum payment), limits, rates, account_summary, upcoming_installments, transactions, declared_totals`.
- **Transactions**: `section, block, block_cardholder, date, description, voucher, ars, usd, installment_number, installment_count, raw_line`.
- **Quirks**:
  - Dual currency: ARS and USD columns per tx; payments show applied exchange rate in description (`TC1510,000`).
  - Cuotas: `installment_number/count` per tx; `upcoming_installments` gives known future monthly amounts.
  - Taxes as separate lines: IVA RG 4240, IIBB percepciones, RG 5617 30% (debits + refunds).
  - Promos/bonifications as negative lines.
  - `declared_totals` enables integrity check vs summed transactions.

## 3. Analyses Catalog

| Analysis | Question answered | Method |
|---|---|---|
| Recurring charges | What do I pay every month? | Merchant+amount clustering across statements; cadence detection (monthly/annual) |
| One-time purchases | What were the big one-offs? | Tx not matching recurring clusters, above size threshold |
| Personal inflation | How much did MY basket inflate? | Reprice recurring basket over time vs INDEC IPC |
| Future charges | What will I owe? | 3 layers: known cuotas (certain) + recurring projected (expected) + variable-spend trend, inflation-adjusted (estimated) |
| Suspicious charges | Anything wrong? | Never-seen merchant + duplicate detection (same merchant+amount, close dates) + recurring amount jumps >threshold + statement math check (declared_totals vs sum) |
| Period comparison | Better or worse than before? | Month/quarter/year deltas in real terms |
| Categorization | Where does money go? | 2-level taxonomy (~12 top: food, transport, subscriptions, health, entertainment, shopping, services, travel, education, taxes/fees, transfers, other + subcategories). LLM classifies unknown merchant strings once → persistent mapping file → rules take over |
| Tax burden | True cost of purchases? | Both views: pre-tax for merchant analysis, tax-inclusive for true cost |
| Cuota debt burden | How committed is my future? | Months of committed payments, total, per-month waterfall |

**Two accounting views, toggle everywhere**:
- **Accrual**: full price at purchase date → "what did I spend?"
- **Cash-flow**: what each statement bills → "what will I owe?"

## 4. Chart Catalog

1. **Stacked area** — monthly spend by category over time (real ARS default; nominal/USD toggle)
2. **Sankey** — card → categories → merchants, one month
3. **Calendar heatmap** — daily spend intensity
4. **Cuota waterfall** — committed future payments by month, 3 projection layers
5. **Category drill** — bars → subcategory → merchant → tx list
6. **Recurring charges table** — merchant, cadence, last amount, % change, next expected date
7. **Period comparison** — grouped bars month/quarter/year + % delta in real terms
8. **Inflation lens** — personal inflation (own basket repriced) vs INDEC IPC line ← differentiator
9. **Dual-currency split** — ARS vs USD spending over time
10. **Anomaly timeline** — flagged tx markers on spend line

**ELI5 screen (screen one, no scroll)**:
- Spent this month (↑↓% real vs last month)
- Next statement forecast ("you'll owe ~Z on due date")
- Top 3 categories mini-donut/bars
- Alerts count (suspicious/new/jumped)
- Cuota burden ("committed: N months, total W")
- 12-month sparkline (real terms)

## 5. Projection Model Spec

| Layer | Source | Certainty |
|---|---|---|
| Certain | `upcoming_installments` + active cuota schedules | Contractual |
| Expected | Detected recurring charges, projected forward with recent amount + inflation | High |
| Estimated | Variable spend trend extrapolation, inflation-adjusted, shown as band | Low — band, not line |

## 6. Currency & Inflation Spec

- **Default**: CPI-adjusted constant pesos (INDEC IPC).
- **Toggles**: nominal ARS, USD at MEP rate.
- **CPI source**: fetch INDEC/datos.gob.ar API at ingest, cached fallback.
- **USD rate source**: MEP historical series (dolarapi.com or similar), cached.

## 7. Categorization Spec

- 2-level taxonomy (see §3).
- Flow: new merchant string → check persistent mapping file → miss → LLM classifies (merchant string only, no amounts/dates/account) → write to mapping → future statements hit cache.
- Manual override always wins, stored in same mapping file.

## 8. Competitor Research Findings

Condensed summary — full cited notes in [research-financial-apps.md](research-financial-apps.md) (researched 2026-08-25, primary sources).

### Mainstream US trackers (Mint†, YNAB, Monarch, Copilot, Rocket Money, Empower, PocketGuard, Simplifi)

- **Mint died 2024-03-23**: Intuit folded it into Credit Karma ("Mint is going away, and we have phased communications and user migration by design"); accounts/net worth/3yr transactions migrated, **budgets and custom categories did not**. Free-with-ads aggregation proved unsustainable — every successor is a $50–150/yr subscription.
- **Categorization**: everyone claims "automatic"; only Copilot documents the mechanism — a **per-user ML model** (transaction name, amount, weekday, card) that activates after 30 reviewed transactions and **won't apply low-confidence predictions** (shows top-2 guesses instead). YNAB is deliberately manual + payee memory. Correction-as-training-signal is universal.
- **Recurring/subscription detection** is the most marketed post-Mint feature (Rocket Money's entire business, incl. paid cancellation concierge). Monarch/Copilot/Simplifi/PocketGuard all auto-detect and maintain an upcoming-bills view.
- **Forecasting**: Simplifi is best-in-class — **Projected Cash Flow** graphs balances 12 months ahead from recurring income/bills + planned spend, with what-if scenarios; Watchlists project likely monthly totals vs 12-month average. PocketGuard reduces everything to one safe-to-spend number ("In My Pocket") plus a "PACE" month-trend forecast; Copilot draws a dotted ideal-pace "spending line". Always a single line — never uncertainty-graded.
- **Anomaly detection: nobody has it.** Closest are Rocket's balance-threshold alerts and Simplifi's watchlist target alerts.
- **Multi-currency/inflation**: YNAB says "create a separate budget" per currency; Monarch sums mixed currencies "as if they are the same currency"; nobody handles inflation at all.
- **Home screens** converge on: one status number + upcoming bills + top categories + trend chart, in customizable tiles (Simplifi ships 12 default tiles). Charts are pies (categories), lines (trends), bars (cash flow).
- **Ingest**: aggregator sync everywhere (Plaid/Finicity/MX/Akoya/Yodlee); CSV import as fallback (YNAB drag-drop needs no pre-formatting).

### Argentine / LatAm apps

- **CPI-adjusted real-terms views: confirmed absent across the entire market** — banks (Galicia, BBVA, Santander), wallets (Ualá, Mercado Pago, Belo), trackers (Finy, Ábaco, MonAi, Toshl, FocusFolio). The only personal-inflation artifact is Buenos Aires' **"Tu Inflación"** web calculator — manual, disconnected from spend data.
- Argentina's answer to inflation is **dollarization, not deflation**: Belo converts pesos to stablecoins; Ábaco and FocusFolio keep dollar-terms ledgers (blue/MEP rate **stored at transaction time** — the local best practice); banks sell USD accounts.
- **Cuotas**: bank apps show pending installments as a statement list and sell refinancing (Galicia "Cuotificación" — debit purchases into 3 cuotas post-hoc; Santander "Plan V" — refinance statement balance). **Finy** is the only app that auto-detects cuotas and splits them into future months. **Nobody offers a consolidated future-commitment projection across cards.**
- **Finy** (AR, AI tracker) is the closest local analog: voice/photo/chat entry, **bank-statement PDF import** ("extrae cada movimiento"), Mercado Pago sync, AI categorization, cuota splitting — but no CPI, no anomaly detection, freemium tx caps.
- **BBVA "Mi día a día"** is the deepest bank PFM: category/subcategory breakdown, manual recategorization (no learning yet), per-subcategory budgets. Mercado Pago "Tus gastos": monthly pie + category evolution + budget bar. Both nominal-only.

### Open-source self-hosted

- **Actual Budget** (NodeJS, ~28k stars) validates the local-first plan: **client-side SQLite as source of truth**, CRDT sync (per-field LWW messages, hybrid logical clocks, merkle-trie diffing) with the server as dumb encrypted relay. Its **Schedules** ship concrete heuristics worth stealing: amount match **±7.5%**, date window **±2 days**, and **"Find schedules" mines history to suggest recurring patterns** — the only OSS recurrence detection found.
- **Firefly III** (PHP/Laravel): the most sophisticated **rules engine** (trigger/action groups, strict/any matching, expression engine); "subscriptions" carry min/max expected amounts and predict expected-vs-paid; its **Data Importer is a separate app** behind the API ("for security and maintenance reasons") with **two-mode duplicate detection** (content hash + external ID).
- **Maybe Finance** (Rails/PostgreSQL): archived 2025-07-27 despite ~$1M invested and 40k stars — pivoted B2B; community fork **Sure** keeps it alive (opt-in OpenAI chat + AI categorization). Cautionary tale: B2C personal finance doesn't sustain a company; simple personal tools (Wallos: PHP+SQLite; Paisa: Go+Svelte over plain-text ledgers) stay healthy.
- **Ghostfolio** (Angular/NestJS/Prisma/PostgreSQL): investments only. **Wallos**: subscription tracking with multi-channel renewal notifications and charts+calendar. **Paisa**: CSV/Excel/**PDF** import templates, recurring calendar, retirement forecasting.
- Across all OSS: categorization is **rules, not ML**; anomaly detection absent; multi-currency common but inflation handling nonexistent; bank sync converges on GoCardless+SimpleFIN (no AR coverage — irrelevant here).

### The gap map

Nobody, anywhere: (1) **personal-inflation tracking** (own basket repriced vs official CPI), (2) **real-terms default views**, (3) **cuota-aware multi-layer projections**, (4) **uncertainty-graded forecasts**, (5) **statement-integrity/anomaly checks**. All five are core to this app's design.

## 9. Feature Synthesis: steal / skip / differentiate

| Feature | Seen in | Verdict | Why / how it maps here |
|---|---|---|---|
| One at-a-glance status number | PocketGuard "In My Pocket", Simplifi left-to-spend/day, Copilot "Free to Spend" | **Steal** | Validates ELI5 screen (§4); our number is "next statement forecast" — what you'll owe, not what's left to spend |
| Recurring detection from history | Actual "Find schedules"; Monarch/Copilot/Rocket detection | **Steal** | §3 recurring clustering; start from Actual's constants: date ±2 days, amount ±7.5% — then widen amount tolerance since AR inflation makes jumps a *signal* (personal-inflation input), not a mismatch |
| Confidence-gated ML categorization + review queue | Copilot Intelligence (30-tx activation, top-2 guesses, skips low confidence) | **Steal** | Maps to §7 flow: LLM proposes once per merchant, low-confidence → review queue, manual override wins, mapping file = training memory |
| Rules run idempotently after import | Firefly rules engine; Actual rules (auto-created from user behavior) | **Steal** | Persistent merchant-mapping file is a rules table; re-runnable over all 27 statements; auto-promote repeated manual fixes into rules |
| Import pipeline as separate component | Firefly Data Importer ("separated for security and maintenance reasons") | **Steal** | Confirms §10 shape: `pdf_to_json.py` stays outside the app, behind an endpoint in Phase 3 |
| Two-mode duplicate detection at ingest | Firefly (content hash + external ID) | **Steal** | Hash (date, merchant, amount) + `voucher` as external ID; complements `declared_totals` integrity check (§3) |
| Local-first SQLite, no server dependency | Actual Budget architecture | **Steal** | Already the plan (§10); Actual proves it at scale. Skip its CRDT sync layer — single-machine app doesn't need multi-device merge |
| Exchange rate stored at transaction time | Ábaco "tipo de cambio del momento", Toshl custom rates | **Steal** | Join MEP series at ingest, not display time; statements already carry applied `TC` rates on payments (§2) |
| 12-month projected cash flow with what-ifs | Quicken Simplifi | **Steal + differentiate** | Same horizon, but split into 3 certainty layers (§5) — cuotas contractual / recurring expected / trend band — instead of Simplifi's single line |
| Bills expected-vs-paid tracking | Firefly subscriptions (min/max expected), Copilot recurrings tab | **Steal** | Recurring table (§4 chart 6): last amount, % change, next expected date; amount-jump flag doubles as anomaly input |
| Calendar heatmap + Sankey | Wallos/Actual/Paisa calendars; Actual experimental Sankey | **Steal** | Already in chart catalog (§4); rare in commercial apps → visual differentiation is cheap |
| Category pie + trend line + cash-flow bars | Universal (Mercado Pago, Copilot, Simplifi, YNAB) | **Steal** | Table-stakes chart vocabulary for ELI5 tiles and drill-downs; don't innovate where convention aids 5-second reading |
| Aggregator bank sync (Plaid/Finicity/MX/GoCardless) | All US apps, Actual, Firefly | **Skip** | No AR card coverage exists; statement PDFs are the ground truth. PDF→JSON pipeline (only Finy and Paisa do anything similar) is the moat, not a workaround |
| Envelope/zero-based budgeting | YNAB, Actual, Financier | **Skip** | This is an analysis app over past+committed spend, not a budgeting discipline; budgets could be a later Watchlist-style layer |
| Net worth / investment tracking | Empower, Ghostfolio, Monarch, Copilot | **Skip** | Out of scope (§1); card statements don't carry asset data |
| Subscription cancellation concierge | Rocket Money premium | **Skip** | Requires acting on accounts; we're read-only over statements. The *detection* half we keep |
| Customizable dashboard tiles | Monarch, Simplifi (12 tiles), Actual dashboards | **Skip (v1)** | ELI5 screen is deliberately fixed — 6 opinionated tiles (§4); customization dilutes the 5-second answer |
| CPI-adjusted real-terms default view | **Nobody** (AR market dollarizes instead) | **Differentiate** | Core thesis (§1, §6): constant-peso default, nominal/USD-MEP toggles. Whole market is nominal-only |
| Personal inflation vs official IPC | Nobody in-app; only BA's manual "Tu Inflación" calculator | **Differentiate** | §3/§4 chart 8: reprice own recurring basket from actual statements vs INDEC IPC — automatic where Tu Inflación is manual |
| Cuota-aware committed-future waterfall | Nobody (banks list cuotas; Finy splits by month; no cross-card projection) | **Differentiate** | §3 cuota burden + §5 certain layer: `upcoming_installments` gives contractual truth no aggregator app has |
| Uncertainty-layered forecast (certain/expected/estimated) | Nobody (single-line forecasts everywhere) | **Differentiate** | §5 model; render estimated layer as a band, not a line — honest uncertainty is a stated principle (§1) |
| Anomaly / suspicious-charge detection | Nobody (only balance/budget threshold alerts) | **Differentiate** | §3 engine: never-seen merchant, duplicate (same merchant+amount, close dates), recurring amount jumps, declared-totals mismatch — unoccupied territory |
| Statement-math integrity check | Nobody (Firefly's import hashing is closest) | **Differentiate** | `declared_totals` vs summed transactions (§2) — impossible for aggregator-fed apps, natural for statement-fed ones |

## 10. Build Roadmap

1. **Phase 1 — Dashboard**: Next.js/React + Recharts/Tremor/shadcn reads JSONs directly (SQLite ingest step). ELI5 screen + charts 1, 5, 6, 7.
2. **Phase 2 — Depth**: SQLite as source of truth, remaining charts, projections, anomaly engine, CPI/MEP fetchers.
3. **Phase 3 — App**: drag-drop PDF upload in UI (pipeline: `pdf_to_json.py` behind endpoint), auto-categorization flow, alert history.

**Stack**: Next.js/React + SQLite; Python only for PDF→JSON pipeline. Ingest workflow: manual drop in `pdfs/` + run script (now) → UI upload (Phase 3). UI in English, merchant/category names as-is.
