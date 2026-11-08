# Tarjetas build specification

For a new computer, begin with [Continuing the rebuild](START-HERE.md) to select the committed branch, verify the handoff and resolve that machine's runtime.

Build a working **PostgreSQL-only Tarjetas application with a Laravel API in `backend/` and an independent React + TypeScript + Vite SPA in `frontend/`**, preserving the financial features, evidence history, and English/Spanish interface described here and in the [project context prompt](../project-context-prompt.md). Follow the mandatory [Laravel and React architecture specification](architecture.md), including `/api/v1`, Sanctum cookie authentication, CSRF, credentialed CORS, independent deployments, and multiple users with isolated finances. Registration and account provisioning are outside scope. Implement and verify when a build is authorized; this documentation update does not authorize starting the rebuild or changing the live app.

The owner selected PostgreSQL only on November 4, 2026. Recreating the old SQLite web backend and its approximate installment recognition is outside this build. Historical evidence, explicit opening obligations, source-only associations/classifications, and reconstruction provenance remain supported concepts. This specification does not require binary compatibility with old SQLite archives or reconstruction of the owner's personal installation.

Use the context prompt plus this entire directory as the handoff package. They contain no production credentials, personal statements, personal product catalog, or private balances; synthetic authentication identities are test-only. The source baseline is `c3ad289`. The context prompt supplies the original 56-table schema, 13 migrations, domain declarations, feature explanations, and financial formulas. This specification supplies build instructions, exact seed data, executable synthetic examples, report projections, and acceptance criteria. The architecture specification takes precedence over historical Next.js, server-action, no-authentication, SQLite, and single-user assumptions. Its ownership extensions are required changes to the baseline schema, not changes to the financial expectations.

## Meaning of the same app

The rebuild must produce the same accepted purchases, native balances, review decisions, analytical values, and navigable evidence for the specified inputs. Preserve all 32 routes and current chart/report capabilities. Preserve actual card identity, original amounts, ordered source occurrences, immutable documents, revision history, original-period corrections, and the distinctions between acquisition, billing, repayment, credit, opening debt, and forecast.

Use the existing financial SQL schema and stable catalog identifiers as the baseline persistence contract, then add the ledger ownership, Eloquent-compatible surrogate primary keys, scoped logical uniqueness/composite foreign keys, scoped guards, authentication and session structures required by the architecture specification. The target is no longer exactly 56 unchanged tables. Internal helpers, component boundaries, generated UUID values, and code organization may differ. Test adapters run each financial fixture inside one ledger and map generated UUIDs to fixture identities; they must not change account IDs within that ledger, actual card IDs, source occurrence order, native amounts, or effective dates. Do not weaken the SQL guards to make a fixture pass.

Preserve the visual structure, chart types, theme, responsive behavior, and interaction hierarchy specified below, adding SPA login/logout and authenticated route handling. Pixel-identical screenshots of an unknown private dataset are not an acceptance condition. Authentication and user isolation are explicitly required; bank integration, budgets, registration/provisioning flows, currency settlement, asset depreciation, and new financial policies remain outside scope.

## Package contents and independent verification

| Material | Purpose |
| `START-HERE.md` | Portable branch setup, reading order, dependency-free checks and an implementation kickoff prompt for another computer. |
| --- | --- |
| `fixtures/pdf/` | Five real synthetic PDFs: Visa, Mastercard, Mercado Pago, Coto, and an unsupported layout. They contain invented identities and values. |
| `visa.expected.json`, `mastercard.expected.json`, `mercadopago.expected.json` | Complete expected Python extraction, including evidence fields absent from the narrow integrity projection. |
| `schemas/statement-extraction.schema.json` | Extraction envelope with additional properties retained. Financial cross-field validation belongs to admission. |
| `receipt-valid.rows.txt`, `receipt-one-cent-error.rows.txt`, `receipt-corrected.rows.txt` | Valid receipt transcript, deliberately injected one-cent OCR error, and correction. The injected error is a deterministic extraction seam, not a claim about Vision's output on every OS version. |
| `cards.json`, `catalog.json`, `references.json` | Empty-installation card registry, exact system accounts/primary-purpose groups, and small deterministic IPC/MEP tables. Card-specific account creation is specified below. |
| `outcomes.json` | Fixed import, ledger, receipt, opening, valuation, and error expectations in explicit units. |
| `algorithm-cases.json` | Exact rounding, ordering, partial issuer allocation, later issuer reservation, recurring, and forecast cases. |
| `supermarket.json` | Two synthetic shopping trips, canonical item facts, and independently specified arithmetic expectations. |
| `report-input.json`, `reports.expected.json` | A six-month synthetic report dataset and frozen complete current report projections, including tax/billed/value variants. This input is a read-model fixture, not a set of posting commands to import as a ledger. |
| `routes.json`, `localization.json`, `theme.css`, `chart-colors.json`, `formatting.json` | Exact route controls, translations/locale metadata, visual/chart themes, and display-format vectors. Dynamic title behavior is specified below because JSON omits functions. |
| `identity-vectors.json` | Stable source digest, source-key, and charge-fingerprint vectors. |
| `manifest.json` | Fixture identities, sizes, and hashes; verify before using the package. |
| `verify-current.mjs`, `verify-current.ts`, `report-contract.ts` | Reference-source adapters that demonstrate the fixtures against current domain/report code. They never load installation environment files or open a database. A clean-room implementation supplies its own adapter. |
| `verify-parsers.py` | Compares synthetic PDFs with complete expected extraction using the reference Python parser. |
| `verify-ocr.mjs` | Optional actual macOS Vision smoke check on the generated Coto PDF, with no database/server. |
| `check-rebuild-results.py` | Source-independent comparison of a rebuild's report JSON with the frozen projections. |
| `verify-package.py` | Source-independent integrity and structural checks for the supplied package. |
| `validation.json` | Dated verification of this package, including the distinction between executed checks and acceptance still required of a rebuild. |
| `architecture.md`, `architecture-contract.json`, `backend.env.example`, `frontend.env.example` | Required Laravel/React architecture, multi-user isolation, API/authentication contract, environment examples, setup and deployment plan. |
| `implementation-safeguards.md`, `isolation-fixtures.json`, `deadline-fixtures.json`, `backend.testing.env.example`, `backend.browser-testing.env.example` | Mandatory recovery/ownership/browser/test/deployment safeguards and distinguishable synthetic cases. |
| `verify-architecture-plan.py`, `verify-plan-boundaries.py`, `verify-architecture-negative.py` | Static consistency verification of the plan and environment examples. Regression mutations run in memory without project/package copies; no running backend/frontend is claimed. |

Financial inputs, snapshots and their manifest are under `fixtures/`. Architecture documents/contracts, environment examples, verification scripts and `validation.json` are directly under this directory. Hand the builder the whole directory and the context prompt; providing just this README would omit the exact data contracts.

Expected extraction JSON and monetary examples are fixed assertions. The larger report golden was captured from the source implementation using the supplied synthetic input and checked against separate arithmetic cases. Verification does not regenerate expectations. A disagreement requires investigation; do not update a golden merely to make a new implementation pass.

## Empty installation and bootstrap contract

Provide a documented setup command that starts from an empty explicitly selected disposable database and fresh storage roots. It must not read or overwrite an existing installation implicitly.

1. Inspect the repository and runtime configuration before implementation. Preserve `web/`, existing source/data and all uncommitted work. Set up Laravel and Sanctum independently of the standalone React/TypeScript/Vite frontend, using the compatible stable release policy and Lerd commands in the architecture specification. Do not scaffold Inertia, Blade application screens, or Laravel's React starter kit. Python/local OCR remain backend processing dependencies.
2. Start PostgreSQL and create a dedicated empty database. PostgreSQL 18 is the demonstrated reference environment; require no extension for the baseline financial schema. Implement explicit Laravel migrations for the reference accounting model plus ledger ownership/authentication changes, retaining the original migration/provenance records distinctly from Laravel's migration tracking. Do not blindly apply unmodified single-user guards/keys. Migrations run explicitly, never during an upload.
3. Create separate absolute canonical private document and reference roots, initially mode 0700. Owner-specific documents live under `ledgers/<ledger-uuid>/objects/<sha256>` and pending transcripts under `ledgers/<ledger-uuid>/pending/<pending-id>/<sha256>`; file objects use 0600. Object/recovery identities include ledger, kind and reference key, even when two owners have identical bytes. Validate that the roots do not overlap and are writable without following unsafe links.
4. Configure the backend PostgreSQL connection, private document root, reference root, parser executable/scripts, application revision and Sanctum/session/CORS settings. Configure `VITE_API_BASE_URL` in the frontend. Follow the separate environment examples. Financial operations in a PostgreSQL-only build must fail clearly if its database is unavailable; the stateless public liveness route remains available. The financial runtime must not create or select SQLite as a fallback.
5. Seed `catalog.json` accounts and groups inside each user's ledger in parent-before-child order. Names with `labelKey` resolve from `localization.json`. IDs such as `expense:transport` are canonical within a ledger; do not derive IDs from English display names or share a user's mutable catalog with another user.
6. Register the four synthetic cards in `cards.json` for acceptance. A real installation supplies its own distinct card IDs. For each card `C`, create `card:C` under `liability`, `card:C:ARS` and `card:C:USD` under that card root, then `C:ARS:billed`, `C:ARS:unbilled`, `C:USD:billed`, and `C:USD:unbilled` as posting leaves. Native branches use their matching currency; the card root uses its literal display name. Two Visa cards remain distinct.
7. Publish `references.json`'s `cpi` and `mep` maps to the selected reference root as `ipc.json` and `mep.json`. These are synthetic analytical references, not live market data. Seed no merchant financial rules initially. The catalog starts with no personal receipt/product evidence; product identities may be created from receipt intake.
8. Start the backend and frontend separately. Verify the public `/api/v1/health` endpoint from the SPA's actual browser origin, then run the Sanctum login/session/logout journey. Use pre-existing synthetic users and private ledgers for tests; account creation/onboarding is outside this delivery. After login, empty routes must render usable empty states without requiring prior statements. Financial pages and APIs require authentication and owner-scoped authorization.

After importing the Visa fixture into Synthetic Visa A, the first ledger has two purchases and four journals, with ARS 100.00 and USD 5.00 billed separately and no unbilled amount. Importing Mercado Pago into its configured card creates a supported ARS 100.00 purchase/billing and a review for the unexplained three-installment principal; it must not invent ARS 120.00 of principal from ARS 40.00 × 3. The projected March/April ARS 40.00 schedule remains visible despite that review.

Do not seed `synthetic:e1` in a real installation. It is test evidence for isolated domain cases only. Domain fixtures start fresh independently; cumulative results across unrelated cases are not meaningful.

## Extraction and admission contracts

### Full statement output

Match complete expected extraction for all three issuer PDFs, preserving array order and optional source fields. Amounts in extraction JSON are decimal major units; convert accepted money to exact integer cents during accounting admission. Nullable/absent source amounts are not invented zeros. Some Mercado Pago columns explicitly print zero; preserve those zeros.

The common envelope includes file, brand, product, account, cardholder, period, balances, limits, rates, future schedules, transactions, and declared totals. BBVA additionally supplies account-summary rows, four limit fields, four native-rate fields, previous USD balance, and surrounding period dates where printed. Each transaction retains section, purchase block, block cardholder, date, description, voucher, native amounts, installment position/count, and normalized printed `raw_line`.

`voucher` is purchase-identity evidence. Never discard it because the TypeScript integrity projection omits it. Retain unknown future extraction properties in immutable raw evidence while making admission conservative about unsupported meanings.

For BBVA, support column-aligned ARS/USD amounts and voucher columns, multiple purchase blocks, payments, taxes/charges, declared totals, and printed future schedules. Parse Spanish date/month names. Reject unfamiliar rows rather than silently losing them. Parser-level sums tolerate the reference parser's own 0.05 major-unit checks; importer exact checks are a separate layer.

Mercado Pago supplies no year in its statement text. Require a `20xx` year in the filename. Derive transaction/due/previous-period years across December/January boundaries. Distinguish previous gross balance from payments, consolidate section totals, and derive TEM from TEA by compounding, rounded to three decimals. Its `upcoming_installments` is a local ARS equal-installment projection from remaining `m − n` installments after closing month; do not call it a printed issuer commitment table or ledger debt proof. USD rows contribute no ARS principal to this projection.

### Three distinct failure boundaries

| Boundary | Synthetic case | Required result |
| --- | --- | --- |
| Before accounting admission | `unsupported-layout.pdf`; Mercado Pago PDF renamed to omit the year; malformed/unrecognized row | A parser/upload error, no source revision or journal created by the accounting importer. Do not claim pending evidence was persisted merely because bytes reached the HTTP handler. |
| Document admission | Direct JSON importer sees a declared purchase total of 100.01 against extracted 100.00; unsupported JSON brand; revised extraction of a known logical source | Retain immutable evidence with pending admission and the corresponding review code; no new financial posting. The unsupported-brand case is an importer-seam test, not a PDF the web parser successfully reads. |
| Financial interpretation of accepted evidence | Mercado Pago's unsupported principal, ambiguous dual-column purchase, unlinked refund, missing date | Retain accepted source rows and their review events. Post only supported independent rows; do not reject all source evidence or guess the unsupported row's meaning. |

Statement upload: multipart `file` plus actual `cardId`, PDF signature, safe filename, maximum 10 MiB. Missing card gives structured `missing_card_identity`; a brand without configured liability accounts gives `unknown_card`. Structured parser/setup failures remain distinguishable from unexpected server failures. Reuploading the same bytes under a new valid filename cannot duplicate journals. Attempting to assign identical statement document bytes to another card gives `document_identity_conflict`.

A recognized own payment that has negative ARS and USD can produce two native repayment journals sharing the source evidence. A purchase positive in both native columns produces `ambiguous_dual_currency_line`, not two acquisitions. Recognized repayment wording includes `SU PAGO`, `PAGO RECIBIDO`, and supported `PAGO DE/DEL RESUMEN` forms; a `Reembolso` in the payments section is not automatically a repayment.

### Receipt transcript and OCR contract

Use the actual synthetic Coto PDF for rendering/OCR smoke acceptance and the transcript fixtures for deterministic financial acceptance. OCR need not reproduce every whitespace choice, but it must either reach the exact totals through correct extraction or offer the supported rejection/correction flow. Never relax cent verification because OCR differs.

`rowsText` uses `## page N` headers. A label and amount may be separated by a tab, or two or more spaces before a valid Argentine money token. A row without an amount retains a null amount. Ignore empty rows; preserve page and printed item order. Quantities use thousandths, prices/totals use cents, and discount tags are `M` or `A` with signed negative amounts. The package's rice is one packaged unit, not one kilogram sold by weight.

Render PDFs locally, handle tall receipts and overlapping slices, map boxes back to whole-page coordinates, and deduplicate overlap. Preserve code/quantity/discount evidence when merging overlapping page content. Recognition uses the macOS local Vision runtime with Spanish/English source recognition; UI locale does not control OCR language. Try reference scales 3, 2, and 1.5 with bounded child execution. Maximum receipt upload is 40 MiB.

For the valid receipt, require gross 15,000 cents, discounts −2,000, paid total 13,000, two items net 8,000 and 5,000, both `un`. The one-cent-error transcript prints total 13,001 while item sums still yield 13,000. It must fail `verification_failed`, retain rejected evidence, and post no purchase. Applying the corrected transcript must retain the original and corrected objects, connect the new revision to the rejected one, reuse the receipt identity, and pass the exact-cent gate.

Unit-price multiplication, savings/offer summaries, and raw OCR notes can remain warnings. Date, fiscal ID, item presence/known totals, and exact subtotal/discount/total checks govern admission. Arithmetic admission, canonical product identity, actual payment card, and financial account allocation are separate decisions.

## Financial acceptance cases

The following monetary tables use **integer ARS cents**. Expected clearing is debit minus credit; a repayment therefore makes unresolved clearing negative. A liability column is credit minus debit. Do not reverse that sign merely to make a friendly display total.

### Purchase billing payment credit and correction

Start with one purchase on January 15, 2026, principal 60,000. Its allocations, in order, are pantry/Food 42,000, cleaning/Home 12,000, hygiene/Personal 6,000. Bill installment 1 for 10,001 on February 1; repay 5,000 on February 10. Credit 12,000 on April 1, explicitly reducing billed principal by 2,000 and unbilled by 10,000. On May 1, correct the original allocation to pantry/Food 30,000 and abroad/Travel 30,000, preserving principal and original effective date.

| Checkpoint | Expense | Billed liability | Unbilled liability | Clearing |
| --- | --- | --- | --- | --- |
| Purchase | 60,000 | 0 | 60,000 | 0 |
| Billing | 60,000 | 10,001 | 49,999 | 0 |
| Repayment | 60,000 | 5,001 | 49,999 | −5,000 |
| Credit | 48,000 | 3,001 | 39,999 | −5,000 |
| Classification correction | 48,000 | 3,001 | 39,999 | −5,000 |

Billing proportional shares must be `[7001, 2000, 1000]`: floor each exact rational share, then assign the spare cent in allocation order. The credit initially reduces expense by `[8400, 2400, 1200]`. After correction, net expense is Food 24,000 and Travel 24,000. Current outstanding billed components are Food 0 and Travel 3,001. The purpose convention's ordering can differ from the proportional expense split; that is expected.

Retain eight journals: purchase, billing, repayment, original credit, purchase reversal/replacement, and credit reversal/replacement. The purchase replacement remains effective January 15; the credit replacement remains effective April 1; both record the actual May 1 correction time. The current purchase is version 2. Earlier attributions/versions remain inspectable. Replaying the correction adds nothing. A competing expected version 1 fails `stale_purchase_version`. Changing principal after billing returns `correction_requires_schedule_revalidation` without partial postings.

### Repayment attribution and ordering

`algorithm-cases.json` defines three components deliberately supplied out of order. Sort by billed date, then purchase date, then component ID. A 7,000 payment assigns 2,000 to component A, 4,000 to B, and 1,000 to C. Never use input array order or a random database row order.

An explicit issuer allocation of 3,000 from a 10,000 payment leaves 7,000 unapplied even if another component has capacity. Do not complete it conventionally. In the reservation case, a later issuer payment owns 15,000 of a 20,000 component. An earlier conventional payment of 10,000 can use only the other 5,000 and retains 5,000 unapplied. Event ordering is effective date, recorded timestamp, ID. Replay must preserve the later explicit evidence.

Native payment journals affect liabilities independently of analytical attribution. An unapplied amount is not discarded, and its residual can make unattributed debt negative. Maintain latest attribution revision markers even when a latest revision contains zero attributed rows.

### Receipt convergence and product decisions

Run each ordering from a fresh dataset:

1. **Receipt first:** accept the corrected 13,000-cent receipt. Without payment verification, retain `receipt_payment_unresolved` and zero journals. Explicitly verify Synthetic Visa A and full payment; record one unallocated acquisition. Accept both canonical item identities, allocate rice 8,000 to Food, leave 5,000 Unallocated, then allocate soap 5,000 to Personal. The total expense remains 13,000 through corrections. A matching later Coto statement bills that same purchase and leaves billed 13,000, unbilled zero.
2. **Statement first:** import a Coto one-off ARS 130.00 on January 15 into Synthetic Visa A, then import the receipt. Link to that same purchase; no second acquisition and no second 13,000 of expense.
3. **Identity review:** match code first, ordered description rule second, otherwise create an unreviewed product. A canonical product update alone does not approve every item. Moving a code revises code ownership, remaps affected items, and invalidates their approval. Product merge retains a redirect and history. Raw receipt totals, original printed codes, and posted principal remain unchanged.
4. **Historical association:** post an opening billed balance of 13,000 effective February 1. Retain a pre-opening January 15 Coto source and receipt. Linking/unlinking them creates an evidence-decision chain, while the ledger still contains only its opening journal. Use actual source identity, first installment/one-off evidence, the three-day window, and the documented cent tolerance for plan candidates. Enforce active ownership on both sides.

Multiple candidates are reviews. Equal amount/date alone cannot establish identity or principal. A same-source two-occurrence pair remains two purchases. Financial link/unlink actions preserve decision history; unlinking an association does not delete a posted expense.

### Openings and historical refunds

An opening obligation has 12,000 original supported principal, zero already billed at opening, and 12,000 remaining in a two-installment plan. Create opening equity/unbilled liability on February 1. Billing 6,000 on March 1 leaves billed 6,000 and unbilled 6,000, with **zero expense** and only two journals. Replay does nothing; a further 7,000 billing returns `billing_exceeds_opening_remaining`.

For a distinct historical full-refund case, opening billed debt is 13,000. Retain an accepted pre-opening one-off original Coto acquisition of 13,000 and a post-opening March 5 full refund of −13,000. Require explicit full-refund confirmation and matching source/card/currency/amount. Posting the refund against Food produces billed zero and current books expense −13,000 with only an opening and a credit journal. It must not fabricate the old purchase. Its original acquisition remains available in historical analytics. Replay creates no second credit. Partial/mismatched/cross-card historical refunds remain unsupported by this narrow use case.

### Classification merchant and proposal journeys

Provide selected-purchase, future-rule, and explicitly confirmed matching-history scopes. Future-rule alone changes no existing purchase. Preview the exact affected identities by actual card; if they change before submission, require a new confirmation. Merchant substring rules have explicit order; a new manual correction takes precedence. Avoid overwriting an already owned rule through an unrelated proposal.

Permit merchant-family merge with an exact preview/confirmation, preserve original issuer text, reject cycles, and show normalized merchant grouping in all relevant historical reports. Record a new decision rather than deleting the old merchant.

Optional AI classification uses sanitized merchant names, at most 200 per batch, with no documents, amounts, dates, holder/card/account values. Strip six-digit-or-longer tails and refuse money/rate/percentage-shaped strings. Preserve wire text/confidence and require human account/scope selection. For acceptance, inject deterministic proposal responses; never require a live service key. Test accept, reject/suppress, invalid response, missing key, and service failure while ordinary reports remain usable.

## Reports and exact expected projections

`report-input.json` supplies six months of recurring ARS and USD observations, variable grocery purchases, a supported installment purchase and three billings, actual-card statement terms, costs, linked and unlinked credits, duplicate candidates, and a stale schedule. `reports.expected.json` freezes the model results for this exact input. Object key order is immaterial; array order is part of the projection where ranking/chronology matters. Preserve signed amounts and nulls. Generated identities inside read-model fixtures are fixed input IDs; they are not permission to hard-code production values.

Expose an acceptance adapter that takes the fixture input and returns the keys documented by `report-contract.ts`: `spending`, `billed`, `realQuarter`, `usdYear`, `taxIncluded`, `foodDrill`, `flow`, `timing`, `currency`, `pace`, `commitments`, and `supermarket`. Equivalent production internals are allowed; this is a portable comparison projection, not a required public API. Compare using `check-rebuild-results.py`.

Independent arithmetic checks guard against preserving a mistaken interpretation of a large snapshot:

- A January ARS 1,000 purchase plus native USD 5 contributes ARS 1,000 to ordinary nominal peso spending; with March IPC 121 and January IPC 100 it contributes ARS 1,210 to ordinary real spending. USD display gives USD 6 at January MEP 1,000. The nominal currency split is ARS-billed 1,000 and USD-billed 5,000, totaling 6,000 only in that special lens.
- If those purchases are instead billed in February at MEP 1,100, the billed USD total is `1000/1100 + 5`. The original acquisition month must not choose the rate for billed scope.
- Two ARS 1,000 acquisitions in January and February, with CPI 100/200 and MEP 1000/2000, sum to real ARS 3,000 or USD 1.5 for their quarter. Convert each constituent month before aggregation.
- Four monthly ARS 100 subscription observations qualify as active/high-confidence; three do not. June as the newest imported month makes a last April occurrence lapsed. Do not use today's wall clock or infer annual cadence.
- A forecast starting April with schedule 90/60, recurring 20, variable range 10–30, and monthly inflation 10 percent has first nominal layers 90, 22, 11, 33. First real layers are `90/1.1`, 20, 10, 30. There are six months; stale schedules do not contribute. Keep USD recurrence excluded from the expected ARS layer.
- Two shopping trips at 13,000 and 15,500 cents yield average 14,250; weekly-based monthly indicator 61,702.5; cumulative paid 28,500; savings 4,500. Their comparable gross index is 120 and effective index `15500/13000 × 100`. Rice gross/net changes are 20/25 percent. Without reviewed products, raw savings remain 4,500 while trusted product comparisons are empty.

Use `outcomes.json` and `algorithm-cases.json` for exact operation inputs/results. Integers compare exactly. Finite derived floating-point values allow relative error at most `1e-9 × max(1, abs(expected))` before UI formatting. Native cents must never use that tolerance. UI formatting follows the translations/reference money conventions and cannot change accounting values.

## Route and interaction acceptance

The complete financial descriptions in the context prompt remain required. This matrix covers the original 32 financial SPA routes; login and session/health integration are additional requirements in the architecture specification. Dynamic `[id]` entries denote client-router parameters. The report golden covers calculations; browser acceptance proves authenticated controls, links, and actions. A successful pure calculation is not proof of a working screen.

| Route | Visible acceptance |
| --- | --- |
| `/` | Overview totals/previous change, next forecast layers/range, top accounts, installment summary, sparkline, open alerts, and drill links match `commitments.overview`. Title shows newest closing date. |
| `/anomalies` | Render spending/alert timeline and review list from `commitments.alerts`. The synthetic duplicates/new merchant are visible. Review/dismiss/reopen changes overview count and persists after refresh without changing money. |
| `/trends` | Stacked area and period grouping match `spending.stacked`; real-quarter/USD-year/tax variants agree with corresponding goldens. |
| `/categories` | Breadcrumb account hierarchy and merchant/source rows match `foodDrill`; preserve modes/period, expose source/journal/receipt links, cap detail at 200, and allow scoped corrections. Show separate native purpose expense/debt/repayment measures. |
| `/merchants` | Ranking/Pareto, counts/shares/activity, top-five/top-twenty shares, and novelty timeline match `spending.merchants`. Chart top 20 and detail top 15; period selection does not rewrite the separate novelty history. Merge preview and confirmation work. |
| `/movers` | Latest two available buckets and signed category contributions match `spending.movers`; zero prior gives null percentage, and fewer than two buckets gives an empty explanation. |
| `/compare` | Totals and previous percentages match `spending.compare`; expandable values table works; missing card coverage is disclosed. |
| `/sankey` | Card/account/merchant nodes and positive conserved edges match `flow`; selected period is reflected in title. |
| `/calendar` | Purchase-date heatmap and selected-day details match `timing.calendar`; native USD evidence remains inspectable; linked receipt and source navigation work. |
| `/habits` | Weekday amounts/counts/mix and ticket total/count/mean/median match `timing`; refunds are not new visits. |
| `/pace` | Actual-card selector, cycle windows, cumulative values, and same-card prior medians match `pace`; missing previous closing produces no fabricated window. |
| `/recurring` | Active/high-confidence, regular-variable, and lapsed rows, currencies/migration, amounts, changes and next/last period match `commitments.recurring`. |
| `/currency` | Native billing splits match `currency`; special peso inclusion of USD is explained and differs from ordinary peso spending as specified. |
| `/inflation` | Recurring-price basket/index and IPC comparison match `commitments.inflation`; show basket membership and empty/no-overlap behavior. |
| `/taxes` | RG 5617/IVA/IIBB/stamp/interest/other, totals and denominator semantics match `commitments.taxes`; show null rates where undefined. |
| `/credits` | Promotion/refund/tax recovery periods and top credits match `commitments.credits`; own repayments are excluded, unresolved source credit remains distinguishable. |
| `/float` | Modeled delays/gain and installment/one-off split match `commitments.float`; compare recorded interest and disclose the due-date assumption. |
| `/future` | Six separated certain/expected/estimated bands match `commitments.forecast`; show assumptions and incomplete coverage, with no future postings. |
| `/installments` | Billed burden/share/counts and current plan balances match `commitments.installments`; unknown plan count remains null, and Future link works. |
| `/bank` | Per-card limits/rates, balances/utilization/minimum ratio, worst TEM/inflation comparison and real limit erosion match `commitments.bank`/`realBank`; missing-card months have limit gaps. |
| `/super` | Shopping KPIs, paid/discount bars, gross/effective indices and promotion-family savings match `supermarket`; raw savings survive pending identities. |
| `/super/products` | Product trend/change/top 15, quantities, frequency and basket movement match `supermarket.products`/`top`/`frequency`/`basket`. |
| `/super/categories` | Product-department matrix matches `supermarket.categories`; separate financial-account matrix conserves receipt net amounts and exposes Unallocated remainder. |
| `/receipts` | Upload valid Coto PDF; show verified receipt. Inject the one-cent transcript failure, display checks and correction editor, retry correction, retain both transcripts and deduplicate another upload. |
| `/receipts/[id]` | Fiscal/payment data, item quantities/SKU/EAN/gross/discount/net, warnings and accepted transcript; actual-card verification, product confirmation and partial/full allocation journeys all work. Unknown ID returns not found. |
| `/super/charges` | Matched/unmatched/ambiguous receipts and charges, missing receipt list, financial/historical link distinction and link/unlink history. No duplicate expense or ownership stealing. |
| `/super/review` | Product save, unit/category/name review, merge, code movement and rematch; affected matches become unapproved, source rows remain intact, and useful validation errors persist. |
| `/upload` | Actual-card selection, all three issuer fixtures, summaries/history, stale-IPC indication, parser/setup feedback, renamed replay and pending revision behavior. |
| `/review` | Unallocated purchases, deterministic proposals, accept/reject, selected/future/history scope, exact preview confirmation and clear errors. No key/service availability required for manual review. |
| `/accounting` | Native account balances, opening coverage, custom group expense/debt/repayment, journals/debit-credit lines, effective/recorded timestamps, source links and unresolved clearing explanation. |
| `/accounting/settings` | Rename/reset built-ins, literal bilingual custom name, built-in group rename, overlapping cross-type custom group creation/editing, and immutable account identity. |
| `/accounting/evidence/[id]` | Admission status, recording time, original PDF, printed source line and extracted JSON; follows journal/report links. Unknown/invalid evidence returns not found. |

### URL controls and display defaults

`fixtures/routes.json` is the exact per-route control matrix. Omitted control definitions mean no toolbar on that route; an empty `toggles` object means value/spend/tax controls are enabled; `spend:false` or `tax:false` removes the corresponding control. Value remains where toggles are present. Respect `granularities`, `basisCaption`, and `period` fields.

Default URL modes are acquisition (`spend=accrual`), real pesos, tax excluded, monthly. Unsupported mode strings fall back to those defaults. Unsupported `g` falls back to month. Category/Sankey periods default to latest available; merchant ranking defaults to `all`. Invalid selected period falls back by that route's rule. Switching granularity removes the old incompatible period while retaining the current drill and other modes. Changing a mode preserves other query values and scroll position. Browser refresh/back/deep linking reconstruct the same report.

Calendar, habits and pace calculations always use acquisitions even if `spend=cash` is manually present. Installment burden uses billings. Native accounting balances and evidence remain unconverted. The word cash denotes billed scope in this UI, not verified bank outflow.

## Visual and bilingual requirements

Use `theme.css` and `localization.json` as the concrete style/content reference. Preserve the semantic positive/negative/warning palette, tabular financial numbers, clear native currency units, light/dark OS preference, chart tooltips and legends, and sufficient table/axis contrast. Use the existing chart types listed in the context prompt, not generic replacement cards that remove comparisons.

Use `chart-colors.json` for light/dark chart category, product-department, series, grid and tooltip colors. `formatting.json` pins formatting independently of interface language: ordinary peso charts use `es-AR` ARS formatting with zero displayed decimals, receipt/native-account cents use two decimals, USD uses `US$ ` followed by two decimal digits with a period, and signed percent changes use a comma and one decimal digit. Undefined percentages display an em dash. A rounded chart label must not round the underlying ledger.

At desktop width 1024 px and above, navigation is a sticky 240 px sidebar with collapsible purpose groups and the active group open. Smaller screens use the explicit menu. Content padding is 16 px horizontally/24 px vertically on small screens and 32 px on desktop, with a broad capped content column. Header/filter rows reserve their shared space so navigation does not shift the page content vertically. Inputs/buttons have at least 44 px useful touch height; wide reports scroll within their region rather than pushing the whole page wider.

Test 390 px, 1280 px, and 1920 px widths, both appearance schemes, and keyboard-only navigation. The language switch persists using the fixture's cookie name. English is default even for a Spanish browser `Accept-Language`; choose Spanish only after an explicit supported selection. Set document `lang`. Custom account/group names and original merchant/product/source text remain literal in both languages. Interpolated errors and action success messages must be translated without losing entered values or changing numbers. The package includes the current string dictionaries so a builder need not invent missing accounting labels.

Provide a skip link to main content, visible keyboard focus, form labels, accessible menu/group expansion state, appropriate headings/table headers, reduced-motion support, and retained errors. Browser acceptance must inspect console/network failures and evidence downloads as well as visible screenshots.

## Persistence and HTTP acceptance

Apply schema guards in PostgreSQL, then prove them on a guarded disposable database using real SQL, independently of in-memory tests. The ownership fixture includes a B-only account/A-ledger FK tuple that must fail with SQLSTATE 23503, successful shared-key controls, and a separate forged-owner HTTP case. A controller rejection is not database proof:

- A posted journal has two or more nonzero-sided valid lines, balanced native cents, at least one evidence link, and enabled currency-compatible posting leaves. ARS/USD cannot cross-balance.
- Attempted updates/deletes of posted headers/lines/evidence and immutable histories fail. Draft posting with imbalance/missing evidence/nonleaf/disabled/wrong-currency account fails. Account cycle and invalid parent/type edits fail.
- Concurrent identical import/command calls produce one financial result; conflicting semantic reuse fails; competing corrections require expected-version freshness. Source chains and receipt link chains cannot fork, and live ownership is unique.
- Rolling back admission/financial writes leaves no half-admitted database state. An immutable object written before the transaction may remain unreferenced; retry verifies/reuses its bytes. Do not claim filesystem writes participate in the SQL rollback.
- Opening obligations, component/credit/attribution revisions, and purpose balances conserve native amounts. Persist and reload the ledger correction fixture and compare the same results through the PostgreSQL reader.

Preserve the behaviors of the four original HTTP handlers through their versioned Laravel replacements in the architecture specification; their original Next.js URLs are not the target routing contract. Receipt correction accepts `{sha256,rowsText}` and uses owner-scoped retained original evidence. Receipt exact-verification rejection returns HTTP 422; domain validation errors retain structured HTTP 400 semantics, while standard field validation may use the specified Laravel 422 envelope. Successful imports return JSON. Unknown or exclusively other-owner evidence/object paths return not found; shared keys resolve to the caller's own reference; malformed object hashes return 400. The SPA original-PDF button must fetch bytes with its authenticated HTTP client and open a blob, following the popup/error/lifecycle contract in [implementation safeguards](implementation-safeguards.md); a raw API new-tab link is insufficient for Sanctum SPA authentication. Document retrieval must authorize a persisted ledger-scoped object reference, verify hash/size, serve PDFs inline and other objects as attachments, and send private/no-store plus nosniff. No caller-controlled filesystem path is accepted.

All financial edits use authenticated, CSRF-protected versioned Laravel HTTP handlers invoked directly by the SPA. Replace Next.js server actions; keep financial use cases and authorization on the backend. Do not expose unrestricted journal/database CRUD to make browser tests convenient. Test adapters and synthetic seeding must be disabled or isolated from ordinary installation use.

## Recovery and operational acceptance

Provide explicit reference updates with atomically published complete IPC/MEP files and process-cache reload behavior. Test with local provider stubs; do not require live internet or send private financial records. Missing/too-old rate tables produce actionable setup errors. Reference refresh changes analytical valuation, not posted native journals.

Provide migration, synthetic demo, historical/opening reconstruction, release-check, PostgreSQL backup/verify/restore, and integrity-check operations with explicit targets. Reconstruction can use portable extracted source/decision input; recreating the old SQLite UI is unnecessary. Preserve original row/object provenance where imported, unresolved cases, ID mappings, and separate opening versus complete historical coverage. Do not declare complete reconstruction from an incomplete opening cohort.

For backup acceptance, use the owner-qualified v2 recovery contract in [implementation safeguards](implementation-safeguards.md) and the exact object/pending reference set in [isolation fixtures](isolation-fixtures.json). Freeze writers, capture all financial rows and protected identity/ledger mappings coherently, exclude sessions and invalidate persistent login credentials, then restore to a different empty disposable PostgreSQL database and fresh roots. Equal hashes in two ledgers remain distinct manifest and metadata-view references. Preserve full-row identities/digests, native balances, guards, reviews/products, correction/link/attribution history and private paths after relocation. Test both shared and exclusive objects/pending transcripts, swapped owners, missing references and login after recovery with old sessions rejected. The historical global-path backup view/tool and full-database dump are reference behavior only and must be rewritten before target use. User exports are single-ledger financial exports without authentication data. Infrastructure recovery is protected administrator material; password hashes belong only in its protected identity component, never ordinary exports. Production secrets and application code are not archive payloads. Wrong archive SHA, corrupted/missing objects, invalid dumps and nonempty targets must be refused without modifying the source. No cloud backup/PITR service is implied.

Provide local macOS OCR/runtime readiness with bounded dependency and database probes. Startup may validate but must not migrate or silently repair financial records. A production build, server startup, and browser acceptance on disposable synthetic data remain required after implementation. Public deployment, external OCR, bank/transfer integration and cross-currency settlement remain separate decisions.

## Delivery sequence and completion criteria

Implement in this order so each stage produces a verifiable increment:

1. **Architecture preflight and authenticated foundation:** preserve existing work, settle the recorded runtime/deployment decisions, create `backend/` and `frontend/`, verify browser-to-API health, cookie/CSRF login/logout, and cross-user isolation before adding financial workflows. Registration/provisioning remains outside scope.
2. **Bootstrap and persistence:** ledger-scoped setup/chart/card seed, ownership-aware schema/transaction guards, source object store, and locale/theme shell.
3. **Financial core:** acquisition/billing/repayment/credit/correction, exact splits, replay, opening obligations, historical source classifications/refunds, and reader projections. Pass native-domain and PostgreSQL persistence cases per user.
4. **Evidence intake:** full issuer extraction, parser/admission/review boundaries, receipt OCR/correction, identity matching and both receipt/statement orders. Pass fixture PDFs/transcripts without private data and prove file/command isolation.
5. **Review and user actions:** product/code ownership, item approval, account allocation, merchant scope/merge/proposals, alert state, catalog/group names, and audit links.
6. **Reports and complete UI:** match the frozen projections per ledger, implement all 32 financial routes plus authentication UI, both languages/responsive schemes, and URL behavior through real browser journeys.
7. **Independent deployment and delivery:** separate backend/frontend builds, trusted ingress deadline propagation before body buffering, cumulative non-OCR phase accounting and separately isolated watchdog testing, disjoint environment cookie parents, reference updates, owner-aware backup/restore and integrity proof, production domain/cookie/CORS verification, and a final acceptance report for every obligation.

The rebuild is complete only when every route and workflow above works on disposable synthetic data; native financial/report cases pass per owner; real PostgreSQL ownership/guards/reload/concurrency/recovery pass; PDF intake and correction pass; and browser tests cover direct API health, Sanctum cookies/CSRF, two-user isolation, actions, links, both languages and mobile/desktop appearance. Backend and frontend must build and deploy independently. Report exactly which checks ran and which remain unverified. The reference package's static/domain tests do not establish a Laravel implementation, SPA integration, deployed service, or PostgreSQL recovery.

From the reference checkout, run:

```sh
python3 docs/rebuild/verify-package.py
python3 docs/rebuild/verify-architecture-plan.py
python3 docs/rebuild/verify-architecture-negative.py
node docs/rebuild/verify-current.mjs
.venv/bin/python3 docs/rebuild/verify-parsers.py
# Optional actual local OCR smoke check on macOS:
node docs/rebuild/verify-ocr.mjs
```

The reference TypeScript adapter needs installed `web` dependencies and bundles its own modules into a disposable executable; the parser check needs the configured project Python with `pdfplumber`. No command above opens the private financial database, loads `.env.local`, starts a web server, or contacts an external service. To compare a clean-room report projection without the original code:

```sh
python3 docs/rebuild/check-rebuild-results.py /absolute/path/to/reports.actual.json
```

The PDF generator uses `reportlab` and deterministic PDF metadata. Regenerating inputs is an authoring operation, not a verification step. Preserve the manifest and frozen expected results until an explicitly reviewed contract change is accepted.
