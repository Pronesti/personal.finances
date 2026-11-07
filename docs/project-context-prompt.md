# Tarjetas project context prompt

You are working with **Tarjetas**, a personal finance application focused on Argentine credit-card statements, Coto supermarket receipts, spending analysis, and evidence-backed double-entry accounting. Use the following specification to understand the existing application before answering questions, proposing changes, or implementing a separately requested task.

This is a source snapshot dated **November 4, 2026**, at commit `c3ad289` on `feat/postgres-accounting-migration`. It describes implemented capabilities, their data model, and their limits. The checked-out installation configures `TARJETAS_BACKEND="postgres"`. The repository also retains a selectable legacy SQLite implementation. Treat those as separate storage implementations with some different financial semantics. Do not describe an old design proposal as current behavior, and do not infer the contents of a private database from code or historical acceptance reports.

Read this entire prompt, including the schema and entity appendices. Then address the task supplied after it. This context alone does not request a rewrite, deployment, import, financial correction, or change to stored data. For an explicitly requested rebuild, use the companion [build specification](rebuild/README.md), its synthetic fixtures, and its acceptance contracts; this context document alone is not a complete build instruction.

**Target architecture override, November 4, 2026:** the requested rebuild uses a Laravel API in `backend/`, a standalone React/TypeScript/Vite SPA in `frontend/`, versioned `/api/v1` endpoints, and Sanctum cookie/CSRF authentication for multiple users with isolated financial ledgers. Registration and account provisioning are outside scope. Follow the [architecture specification](rebuild/architecture.md) over historical Next.js, server-action, no-login, single-user, and unchanged-schema descriptions below. Those descriptions remain facts about the inspected reference app; the original 56-table model requires ownership/authentication extensions for the new target.

## Product purpose and scope

Tarjetas helps one person answer several related questions:

- What did I purchase, for which purpose, and when?
- What did my card issuers bill, and what remains billed or unbilled?
- Which card repayments can be attributed to which billed obligations?
- What do inflation, exchange rates, issuer charges, and installment timing do to my spending?
- Which merchants recur, which changes deserve investigation, and what commitments are coming next?
- What exactly did I buy at Coto, what discounts did I receive, and how have comparable product prices changed?
- Which document and printed line support each accepted financial fact or correction?

The current accounting release focuses on cards. Mercado Pago support here means its **credit-card statement layout**, not complete Mercado Pago wallet or bank integration. The `/bank` page analyzes issuer terms and limits; it is not a bank transaction register.

The application is intended for a single person's finances with explicit distinct cards. It has no application login, user/tenant tables, household sharing, or role-based permissions. Local Lerd operation and persistent PostgreSQL/document storage are implemented. General remote hosting, public exposure, and a portable replacement for the macOS receipt OCR engine require further deployment decisions.

## Technology and application structure

- **Web application:** Next.js App Router, TypeScript, React, server-rendered pages, client components for interaction and charts, and server actions for edits. The package declares Next.js `16.3.3` and React/React DOM `19.2.8`.
- **Presentation:** Tailwind CSS 4 and Recharts 3. The interface has grouped desktop navigation, a mobile menu, responsive layouts, horizontal scrolling for wide tables/charts, contextual page explanations, and appearance following the operating system's light/dark preference.
- **Accounting persistence:** PostgreSQL through `pg`, SQL migrations, explicit transaction ports, and domain use cases under `web/src/lib/accounting/`.
- **Legacy persistence:** SQLite through `better-sqlite3`, with WAL mode and foreign keys enabled. Legacy report/query code remains under `web/src/lib/queries.ts` and receipt modules.
- **Statement extraction:** Python with `pdfplumber`, primarily `scripts/pdf_to_json.py` and `scripts/mp_statement.py`.
- **Receipt extraction:** MuPDF renders PDF pages; local Python/Apple Vision performs OCR; TypeScript reconstructs rows, parses Coto receipts, and verifies arithmetic.
- **Optional merchant proposals:** Anthropic SDK. The current request builder specifies `claude-opus-5`; this is a code setting, not a promise of external model availability.
- **Tests and tooling:** Vitest, TypeScript, `tsx`, Python unittest suites, PostgreSQL integration suites, real receipt/parser acceptance tools, and reconstruction/report/recovery operator scripts.

Important code areas are `web/src/app/` for pages, route handlers, and actions; `web/src/components/` for shared UI; `web/src/lib/accounting/` for the ledger, evidence, review, catalog, and report adapters; `web/src/lib/receipts/` for receipt parsing and analytics; and `scripts/` for Python ingestion and backups.

### Explicit backend selection

`TARJETAS_BACKEND` accepts only `sqlite` or `postgres`; it defaults to `sqlite` if unset. PostgreSQL composition uses `TARJETAS_DATABASE_URL`, an absolute `TARJETAS_DOCUMENT_ROOT`, and separately configured reference storage. A request explicitly selects its backend before reading or mutating financial data. A PostgreSQL failure does not silently fall back to SQLite.

All existing report destinations are included in the PostgreSQL readiness set. The accounting ledger, catalog settings, and source-evidence pages are PostgreSQL features. The memory adapters are test implementations, not another production backend.

Migrations are explicit operator operations, not side effects of an upload. Startup validates database reachability, separate canonical private storage roots, readable parser/OCR scripts, and Python dependencies. The current readiness check requires the macOS Vision runtime and `psql` on the executable path. Readiness is not a substitute for financial integrity or receipt acceptance checks.

## Financial concepts and invariants

### Sources and decisions are different entities

An original PDF is evidence. Its extraction is another retained object. A parsed statement line or receipt item is a source fact. A canonical product match, merchant rule, receipt association, classification correction, and journal posting are decisions made using those facts. They must not overwrite the printed evidence.

Documents are addressed by SHA-256. A source revision has a logical source key, document identity, extraction digest, application revision, admission status, and previous-revision link. Source lines are ordered occurrences within a revision. Two identical-looking printed rows on the same revision remain different occurrences.

Statement source identity includes the **actual card ID and closing date**. A card brand is not a sufficient financial identity. Receipt identity uses the chain/fiscal identity when available and a document hash when fiscal identity is unavailable. Filenames are presentation metadata rather than receipt identity.

### Monetary representation

Accounting amounts are exact integer minor units, normally cents. PostgreSQL uses `bigint` with bounds compatible with JavaScript safe integers, up to `9,007,199,254,740,991`. The application rejects unsafe integers and fractional cents when converting printed source amounts. Receipt quantities are integer thousandths (`qtyMilli`): 1 unit is 1000, and 0.250 kg is 250.

ARS and USD are separate native currencies. Each journal has exactly one currency and balances independently. An ARS credit cannot balance a USD debit. IPC and MEP conversions are analytical report transformations; they do not create accounting settlement entries or rewrite native ledger amounts.

### Purchases, billing, and repayment

A supported purchase recognizes the **full known principal once**. Its allocations debit the accepted expense or supported asset accounts, and its counterpart credits that card's native unbilled liability. Billing an installment debits unbilled liability and credits billed liability. Repaying the card debits billed liability and credits the native unresolved payment-source clearing account.

For example, an evidenced ARS 120,000 purchase paid in three installments initially recognizes ARS 120,000 of acquisition and unbilled liability. Billing ARS 40,000 moves that amount to billed liability; it creates no additional purchase expense. A subsequent ARS 40,000 repayment reduces billed liability; it creates no additional purchase expense either.

Do not infer the original purchase principal solely by multiplying a printed installment by its count. Identity, full principal, and financial nature must have adequate evidence. Ambiguous identities, unsupported installment history, conflicting totals, recoverability of taxes, and unclear credits remain explicit review cases.

The ledger supports five account types: `asset`, `liability`, `equity`, `income`, and `expense`. A type existing in the schema does not imply a complete user-facing workflow for every possible financial event.

### Journal integrity

A journal starts as `draft` and can become `posted` only if it has at least two lines, positive equal total debits and credits, and evidence. Each line has either a positive debit or a positive credit. Accounts must be enabled posting leaves, and any account currency must agree with the journal.

Database triggers prevent changes to posted journals and their lines/evidence. Account parents must preserve type, account ancestry cannot cycle, and posted account structure/type/currency has additional protections. The exact rules are in the SQL appendix.

Command keys and semantic digests make replay idempotent. Reusing a key for different meaning produces a conflict. Financial and source commands retain results. Transactions and PostgreSQL locking protect decisions that must serialize.

### Corrections and historical reporting

Posted purchase corrections append a reversal of the previous posting, a replacement, a new purchase version, and a correction link. The original journals remain inspectable. Linked credit revisions, billed component revisions, and repayment attribution revisions preserve downstream consistency when classification changes.

The effective financial date and the time an action was recorded are separate. A correction can affect the original financial period while retaining its actual later recording time. Reports use the latest accepted classification. There is no separate complete chart mode reproducing every report exactly as it appeared before corrections, and there are no initial period-lock workflows.

Classification actions have three scopes:

1. **Selected purchase:** correct only that purchase.
2. **Future rule:** create or update an ordered merchant substring rule without retroactively correcting the selected purchase.
3. **Matching history:** preview the affected purchases for the selected card/match, confirm that exact set, correct them, and establish the rule.

Historical acquisitions retained as source observations can also receive versioned selected/future/history classifications without inventing posted historical purchases.

### Refunds and credits

Linked refunds/promotions are separate events that follow the original purchase allocation rather than becoming ordinary income. The linked-credit use case explicitly specifies billed and unbilled liability reductions and retains allocation/component reductions. Classification corrections preserve corresponding credit history through reversal/replacement revisions.

A narrower operator/domain use case also supports an explicitly confirmed **full refund of an eligible pre-opening acquisition**. It validates accepted original/refund source lines, card, native currency, amount, refund wording, and opening boundary. It posts the credit once against billed liability and the selected original expense account, without creating an old purchase journal. This does not imply a general partial historical-refund UI.

Unlinked issuer credits remain visible as source evidence and in applicable credit/review reports. They are not automatically treated as income or accepted purchase expense reductions.

### Repayment attribution

Repayments reduce the actual card liability even when their originating bank account is unresolved. Their analytical attribution follows issuer allocations when supplied; otherwise it sorts available components by billed date, purchase date, then component ID. An explicit issuer allocation covering only part of a payment leaves the remainder unapplied; it does not fill that remainder using the convention. During replay, events sort by effective date, recorded time, and ID, and later explicit issuer allocations reserve their component amounts against earlier conventional allocations. Attributions identify billed components, purpose, amount, method, and revision. Unapplied payment amounts and unattributed opening debt remain visible.

Proportional allocation uses integer arithmetic: truncate each `amount × weight / totalWeight`, then distribute remaining cents in allocation order, skipping a share that has reached its weight. This applies to billed components and credit allocation. Changing allocation order can therefore change the destination of a rounding cent.

Expense flow, outstanding debt, and repayment flow are different measures. Do not add them together as if they were separate expenses. Purpose attribution is not proof of the funding bank account.

### Openings and incomplete history

The application supports historical reconstruction and explicit opening-balance modes. Opening journals use opening equity rather than inventing new current-period income or expense. Supported pre-opening installment principal can be retained as an `OpeningObligation` and billed later without creating another acquisition.

An obligation retains original principal, amount already billed at opening, supported remaining principal, purchase date, plan position/count, allocations, evidence, and its opening journal. Later billings identify the opening obligation instead of a posted purchase. A generic opening balance is distinguishable from a known original purchase.

Historical acquisition analytics, issuer observations, posted journal facts, and opening coverage remain distinguishable in the reader. Forecast schedules can contain amounts whose full future principal has not been proved for ledger recognition. The interface exposes coverage and uncertainty rather than treating incomplete reconstruction as complete financial history.

## PostgreSQL database and entity relationships

The accounting migrations create **56 tables** and the `accounting_backup_metadata` view in the default `accounting` schema. The adapter also permits isolated schema names matching `acct_test_[a-f0-9]+` for tests/rehearsals. Its transaction sets an explicit search path and takes an advisory transaction lock. Migrations 011 and 013 extend accepted review kinds without adding tables. Migration 012 adds opening-obligation support to billings. The SQL appendix includes all 13 migrations in order and is authoritative for exact columns, PostgreSQL types, keys, checks, indexes, functions, triggers, and alterations.

Many entities combine relational columns used for integrity/lookup with a typed `jsonb` payload holding their full domain representation. A foreign key inside a JSON payload is not automatically an SQL foreign key. Some selected payload values are generated columns with real foreign keys, such as product ownership. The entity appendix describes the important payload shapes.

### Ledger tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `schema_migrations` | Integer `version` primary key; application timestamp | Tracks installed migrations. |
| `cards` | Text `id` primary key | Actual configured card identity. Display naming is resolved through the card's account catalog. |
| `accounts` | Text `id`; nullable self-reference `parent_id` | Chart hierarchy, accounting type, translated/custom label, optional native currency, primary purpose, posting/enabled flags. |
| `evidence` | Text `id`; kind and JSON metadata | Common identity referenced by journals and source/review entities; kinds are synthetic, statement, and receipt. |
| `commands` | Command `key`; optional card reference; digest and result | Immutable ledger command receipts and replay protection. |
| `journals` | Text `id`; card FK; optional `reverses_id` to another journal | Financial event header, command key, native currency, effective/recorded dates, kind, and draft/posted status. |
| `journal_lines` | Composite `(journal_id, ordinal)`; journal/account FKs | Exact debits/credits with optional purchase/purpose identifiers. `purchase_id` and `purpose_id` here are text attribution fields, not declared purchase/purpose FKs. |
| `journal_evidence` | Composite `(journal_id, evidence_id)`; both FKs | Many-to-many trace from postings to supporting evidence. |

### Purchase and settlement tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `purchases` | Text `id`; card FK; currency | Stable purchase identity across classification versions. |
| `purchase_versions` | Composite `(purchase_id, version)`; unique journal FK | Principal and complete version payload, including account/purpose allocations. The latest version is current. |
| `billings` | Text `id`; card, optional purchase, unique journal, optional opening-obligation FKs | An actual billed installment/amount. Purchase/installment pairs are unique; opening-obligation/installment pairs have their own unique index. The SQL check prevents an opening billing from also having a purchase. |
| `billed_components` | Text `id`; billing FK | Purpose portions of a billing, used for repayment attribution. |
| `payments` | Text `id`; card and unique journal FKs | Repayment amount and payload, including issuer allocation input and unapplied amount. |
| `attributions` | Text `id`; payment/component FKs; unique `(payment_id, component_id, revision)` | Versioned assignment of repayment to a purpose-bearing billed component by issuer or oldest-billed-first method. |
| `linked_credits` | Text `id`; purchase and unique journal FKs | A refund/promotion against a supported posted purchase; payload retains native reduction detail. |
| `correction_links` | Text `id`; purchase, old/new purchase-version, reversal/replacement journal FKs | Reason and recorded time for a consecutive version change. |
| `component_revisions` | Text `id`; component/billing FKs; unique component/revision | Corrected component purpose, amount, and purchase date without overwriting the original component. |
| `credit_revisions` | Text `id`; credit and reversal/replacement journal FKs; unique credit/purchase-version | Revisions needed when a credited purchase changes classification. |
| `attribution_revisions` | Composite `(payment_id, revision)`; payment FK | Unapplied amount for an attribution revision, including revisions with no allocated components. |
| `opening_obligations` | Text `id`; card/opening-journal FKs | Evidence-supported pre-opening installment principal and plan payload. |
| `opening_obligation_evidence` | Composite obligation/evidence key; both FKs | Evidence supporting an opening obligation. |

### Source evidence and issuer tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `source_documents` | SHA-256 primary key; relative path equals hash | Metadata for immutable bytes in the object store, including byte length. The bytes themselves are on disk. |
| `source_revisions` | Text `id` also FK to `evidence`; ordered identity; document/raw-object/previous-revision/card FKs | Logical source key, digest, application revision, recording time, admission state in payload, and extracted source. Revision chains cannot fork. |
| `source_lines` | Text `id` also FK to `evidence`; source revision FK; unique revision/occurrence | Ordered printed issuer rows or receipt items, raw payload, and optional legacy fingerprint. |
| `source_import_commands` | Text command key; digest and result | Idempotent imports and receipt reconciliation operations. |
| `source_purchase_identities` | Composite source-line/currency key; source-line/purchase/card FKs | Maps corroborating issuer observations to a stable purchase, retaining purchase date, voucher, installment, and amount identity. |
| `review_events` | Text `id`; ordered identity; evidence subject FK and previous-event FK | Append-only financial/source review state, code, structured parameters, source-line IDs, and recorded timestamp. |
| `statement_cycles` | Source revision primary key/FK; card FK | Issuer closing date and original period object. |
| `statement_terms` | Source revision primary key/FK | Statement balances, minimums, limits, rates, and any retained account-summary facts in JSON. |
| `issuer_schedules` | Composite revision/ordinal key; revision FK | Ordered future-installment source payloads. BBVA provides printed schedules; Mercado Pago's parser derives an equal-installment ARS projection because its PDF has no forward table. These are analytical schedules, not purchase postings or proof of complete principal. |

### Product and merchant review tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `review_products` | Safe positive bigint identity | Stable canonical product IDs. |
| `product_revisions` | Bigserial `seq`; product FK | Product name, department, unit, reviewed flag, and optional merge redirect. |
| `product_code_revisions` | Bigserial `seq`; logical text ID; generated product FK | Ownership of a chain/SKU, optionally retaining EAN. |
| `product_match_revisions` | Bigserial `seq`; logical ID FK to source line; generated product FK | Per-receipt-item canonical match, matching method, review status, and supported unit correction. |
| `merchant_revisions` | Bigserial `seq`; logical text ID | Normalized merchant, optional display name/order, and merge redirect. |
| `merchant_purchase_revisions` | Bigserial `seq`; logical text ID | Associations between purchase, actual card, merchant, and source line in payload. |
| `merchant_rule_revisions` | Bigserial `seq`; logical text ID | Ordered enabled substring rule assigning account and purpose. |
| `product_rule_revisions` | Bigserial `seq`; logical text ID | Ordered chain/description rules assigning canonical products. |
| `proposal_revisions` | Bigserial `seq`; logical text ID | Merchant suggestion with sanitized wire text, pending/accepted/rejected state, and optional confidence/legacy-taxonomy evidence. |
| `alert_state_revisions` | Bigserial `seq`; logical text ID | Open/reviewed/dismissed alert state and any retained legacy source details. |
| `merchant_rejections` | Bigserial `seq`; logical text ID | Remembered refusal to propose a merchant again. |
| `review_decisions` | Bigserial `seq`; unique ID/key; prior-decision FK | Immutable command digest, subject, decision kind/payload, timestamp, and affected IDs. Includes product, merchant, alert, proposal, source-classification, and historical-refund decisions. |

For revision tables, multiple rows can share one logical entity ID. Current state is selected from the latest sequence for that entity; prior rows form history. A merchant merge or product merge redirects identity and revises affected decisions rather than erasing the original receipt/source text.

### Catalog tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `catalog_commands` | Text key; digest and result | Replay-safe catalog operations. |
| `account_name_revisions` | Text ID; account FK | Audited custom-name changes, including restoration of a built-in label. |
| `account_groups` | Text ID | Stable grouping identity. |
| `account_group_revisions` | Text ID; group FK; ordered sequence | Group label/custom name, account membership, and additive/nonadditive semantics in payload. |

### Receipt and matching tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `receipt_entities` | Safe positive bigint ID; unique chain/fiscal identity | Stable receipt identity. Fiscal identity may be refined from unknown to known under a guarded update. |
| `receipt_entity_keys` | Composite chain/identity-key primary key; receipt FK | Alternate retained keys mapping scans/fiscal identities to a receipt entity. |
| `receipt_facts` | Source revision primary key/FK; receipt and original/corrected transcript-object FKs | Parsed receipt, exact verification report, OCR scale, date/total, and transcript provenance. Includes rejected/pending evidence as well as accepted revisions. |
| `receipt_link_decisions` | Text ID; ordered identity; unique command key; receipt-revision/purchase/card/previous-decision FKs | Link/unlink history for a financial purchase, payment verification, aggregate allocations, and per-item allocations. Active purchase ownership is guarded. |
| `historical_receipt_associations` | Text ID; unique key/digest; ordered identity; receipt/source-line/card/previous-decision FKs | Link/unlink history connecting a receipt to retained issuer evidence even when there is no posted purchase. Currency, amount, date, first-installment, and ownership checks govern matching. |

In PostgreSQL there are no separate normalized `receipt_items`, `receipt_discounts`, or `receipt_transcripts` tables with the legacy names. Parsed items exist in receipt/source payloads, source lines, and product-match revisions; transcript bytes are immutable objects. Likewise, product categories and purposes are stable application values rather than standalone SQL lookup tables.

### Reconstruction tables

| Table | Identity and relationships | Role |
| --- | --- | --- |
| `reconstruction_runs` | Text ID | Source/configuration digests, cutoff date, historical/opening mode, and creation time. |
| `legacy_rows` | Composite run/table/source-ID key; run FK | Exact copied row payload/hash, retained/review disposition, and reason. |
| `legacy_objects` | Composite run/source-path key; run FK | Source path, content hash/size, and retained immutable object path. |
| `legacy_id_map` | Composite run/table/source-ID/target-kind/target-ID; legacy-row FK | Potentially multiple mappings from one retained legacy record to new domain identities. |
| `reconstruction_reports` | Run primary key/FK | Coverage, unresolved cases, reconstruction results, and comparison evidence in JSON. |

`accounting_backup_metadata` exposes application revision, schema version, PostgreSQL server major, dump location, and required object references from persisted evidence and legacy objects. It is a recovery metadata view rather than an analytics materialization.

### Relationship summary

```text
Card ──< Purchase ──< PurchaseVersion ──> Journal ──< JournalLine ──> Account
  │          │                            │
  │          ├──< Billing ──< BilledComponent <── Attribution >── Payment
  │          ├──< LinkedCredit                (versioned)          │
  │          └──< CorrectionLink                                    └──> Journal
  └──< OpeningObligation ──< Billing

Journal >──< Evidence <── SourceRevision ──< SourceLine
                          │       │               │
                          │       │               ├──> SourcePurchaseIdentity ──> Purchase
                          │       │               └──< ProductMatchRevision ──> Product
                          │       └──> SourceDocument ──> immutable object bytes
                          ├──> StatementCycle / StatementTerms / IssuerSchedules
                          └──> ReceiptFacts ──> ReceiptEntity

ReceiptFacts ──< ReceiptLinkDecision ──> Purchase
ReceiptFacts ──< HistoricalReceiptAssociation ──> issuer SourceLine
AccountGroup ──< GroupRevision ──> account membership in JSON
```

These arrows express domain relationships. Use the SQL appendix to determine which are enforced by database foreign keys and which are enforced by application transactions and guards.

## Chart of accounts and classification systems

The accounting chart has nonposting type roots and intermediate accounts, with posting leaves. Built-in expense purposes are **Food, Home, Transportation, Health, Personal, Entertainment, Digital, Education, Travel, Pets, and Financial**, with an explicit Unallocated expense account. The account IDs and built-in label keys are stable across languages.

The implemented catalog contains:

- **Food:** groceries split into produce, meat, dairy, bakery, pantry, drinks, and prepared foods; meal accounts for restaurants, delivery, and memberships.
- **Home:** gas, cleaning, paper goods, kitchen, bedding, furniture, appliances, repairs, and decor.
- **Transportation:** fuel, tolls, parking, public transport, taxi, maintenance, inspection, rental, and insurance.
- **Health:** coverage, medicines, and vision.
- **Personal:** clothing and hygiene.
- **Entertainment:** events, cinema, games, streaming, sports, and hobbies.
- **Digital:** AI, developer tools, creative tools, hosting, domains, connectivity, and devices.
- **Education:** learning materials.
- **Travel:** flights, accommodation, insurance, attractions, luggage, and purchases abroad.
- **Pets:** food, supplies, veterinary care, training, and an unallocated pet account.
- **Financial:** interest, fees, stamp duty, taxes, and fines.

There are also opening equity, unresolved payment-source clearing in ARS and USD, and generated per-card liability hierarchies. Each card has a liability root, ARS/USD branches, and billed/unbilled posting leaves. Leaf IDs follow `${cardId}:${currency}:billed` and `${cardId}:${currency}:unbilled`.

Ordinary durable purchases are expenses by default; explicit asset/prepayment exceptions require an appropriate configured supported asset account. The existing catalog/settings UI supports naming and groups, not an unrestricted general chart-of-accounts designer or an asset depreciation module. The standard seeded asset leaves are unresolved payment-source clearing accounts; their presence does not establish a general asset-management workflow.

Built-in primary-purpose groups are additive. Custom groups may overlap, include accounts across accounting types, and include descendants without counting a selected descendant twice within the same group. Custom groups are nonadditive: totals across overlapping groups must not be summed into a grand total. Their expense, debt, and repayment measures remain separate and native-currency specific. Group measures based on selected ledger accounts differ from the analytical oldest-billed-first purpose attribution.

Users can rename accounts, restore a translated built-in name where one exists, rename groups, and create/edit custom groups. One custom name is displayed literally in both interface languages. A custom rename overrides the built-in display label without changing financial identity.

Three classification layers must remain distinct:

1. **Accounting accounts and primary purposes**, used for financial recognition and current accounting reports.
2. **Legacy merchant category/subcategory rules**, retained for SQLite and as evidence when adapting old AI suggestions.
3. **Receipt product departments**, currently `produce`, `meat_fish`, `dairy`, `deli`, `pantry`, `bakery`, `prepared`, `beverages`, `cleaning`, `personal_care`, `pets`, and `other`.

A product department does not automatically prove an item's final financial purpose. Product approval and purchase allocation are separate actions.

## User interface features

The route tree contains **32 page routes**: the original 29 pages, including receipt detail, plus accounting, catalog settings, and source evidence. The PostgreSQL navigation includes 29 static destinations; settings and dynamic detail/evidence pages are reached through links.

### Overview and investigation

| Route | Implemented capability and interpretation |
| --- | --- |
| `/` | Latest spending period, previous-period change, next forecast range, leading spending accounts/categories, open-alert count and preview, future installment amounts/months, latest closing/due information, and a 12-point spending sparkline. Tiles lead into the relevant reports. |
| `/anomalies` | Spending timeline with integrity/source reviews and computed duplicate, recurring-price-jump, and new-merchant flags. Users can mark reviewed, dismiss, and reopen; state affects overview counts. Detection uses source/billed facts, not arbitrary chart valuation choices. |

### Spending reports

| Route | Implemented capability and interpretation |
| --- | --- |
| `/trends` | Stacked spending over month, quarter, year, or all-history buckets. PostgreSQL rolls accepted account allocations into their top expense branches. |
| `/categories` | Hierarchical account/category drill to merchants and contributing lines, with breadcrumbs, retained valuation/period choices, printed descriptions, native values, source evidence, linked journals, and receipts. Detail rows are capped at 200. Supports scoped purchase corrections and eligible historical-source corrections. Also shows separate native expense/debt/repayment measures by card and purpose, with attribution convention disclosed. |
| `/merchants` | Positive net merchant ranking, Pareto/concentration chart, top-five/top-twenty shares where available, purchase counts and observed activity range, dominant expense account, and new-versus-returning spending. The current PostgreSQL chart uses the top 20 and its detail table the top 15. Ranking defaults to all history; the separate novelty timeline is not restricted by the ranking's period selection. Merchant merging is available. |
| `/movers` | Explains change between the latest two available month/quarter/year periods by account/category contribution, with previous/current amount, signed delta, and percentage where the previous value is nonzero. |
| `/compare` | Successive available period totals, percentage changes, an expandable values table, and incomplete statement-coverage warnings. A missing bucket is not automatically a zero-spend month. |
| `/sankey` | Positive net flow from actual card to expense account to merchant for the selected scope. Current PostgreSQL flows use card/account identity; legacy flows group by brand/category and aggregate a merchant tail. Nonpositive net branches are omitted. |

### Timing and recurring behavior

| Route | Implemented capability and interpretation |
| --- | --- |
| `/calendar` | Heatmap by acquisition/purchase date, daily account totals and charge detail, native USD evidence, and receipt navigation. Purchase identity collapses multiple allocations into one purchase count. |
| `/habits` | Weekday spending/account mix and purchase counts, busiest day and weekend share, period ticket count/total/average/median, and ticket trends. Credits affect spending without becoming new purchase visits. |
| `/pace` | Cumulative acquisition spending within each actual card's `(previous closing, closing]` window, with a selector for the card and a day-by-day median of its prior cycles. Windows without a known previous closing date are omitted. |
| `/recurring` | Active likely subscriptions, regular variable merchants, and lapsed recurring merchants; observed months, last amount, confidence, ARS/USD currency history/migration, comparable price change, and expected/last-seen period. Native currency totals and MEP equivalence are presented without creating future postings. |

### Valuation and issuer economics

| Route | Implemented capability and interpretation |
| --- | --- |
| `/currency` | ARS-billed versus USD-billed spending in the selected common display basis. It explicitly converts native USD into pesos in peso views, unlike ordinary peso spending totals. |
| `/inflation` | An observed recurring-merchant price index versus official IPC, with the merchant basket identified. It measures comparable observed recurring prices rather than an entire personal cost-of-living basket. |
| `/taxes` | Issuer ARS costs grouped as RG 5617, IVA, IIBB, stamp duty, interest, and other, with period totals and overhead relative to a common nominal-peso purchase base. Tax recovery/recoverability remains a separate accounting concern. |
| `/credits` | Promotions, merchant refunds/reversals, selected tax recovery, period money-back totals, percentage of positive billed ARS purchases, and the largest credits. Own card repayments are excluded. Source credits can be visible before their financial linkage is accepted. |
| `/float` | Models purchase-to-due delay and purchasing-power benefit for one-off versus installment billings, with recorded interest as a comparison. It assumes due-date payment for the model; it does not prove actual settlement timing. |
| `/bank` | Statement purchase limits, balances, utilization, minimum-payment share, per-card financing rates, worst available TEM, inflation/real financing comparison, and observed real limit erosion. Incomplete card coverage can leave gaps in total limits. |

### Future commitments

| Route | Implemented capability and interpretation |
| --- | --- |
| `/future` | Six future months with separate certain installment schedule, expected recurring, and estimated variable-spend layers, including a low/high range and inflation assumption. This is an analytical forecast, not a future journal. |
| `/installments` | Historical billed installment versus one-off burden, plan counts/share, current open plans by card/merchant, monthly amount, remaining months, and remaining-principal estimates. Unsupported identities can produce unknown plan counts. Links lead to future commitments. |

### Receipts and supermarket analytics

| Route | Implemented capability and interpretation |
| --- | --- |
| `/super` | Latest shopping total/change, average shopping total, indicative monthly spending, accumulated discounts, receipt paid/discount bars, gross/effective comparable-product price indices, and promotion-family savings. Raw receipt savings remain available while product identities await review. |
| `/super/products` | Repeated-product last gross/net unit-price changes and price trends; top 15 products by spend, quantities, frequency groups, and products entering/leaving the latest basket. Trusted PostgreSQL comparisons require reviewed identity. |
| `/super/categories` | Product-department spend/share/discounts across shopping receipts, plus an accounting allocation matrix showing item net amounts by financial account and receipt, including Unallocated remainder. Product departments and financial accounts are different lenses. |
| `/receipts` | Coto PDF upload, verification report, success/rejection feedback, pending transcript correction/retry, accepted receipt list and provenance, and duplicate detection. |
| `/receipts/[id]` | Fiscal, branch, date/time and payment metadata; printed items/SKU/EAN, quantities, gross prices, signed discounts, net line amounts, verification warnings, transcript and source evidence. PostgreSQL controls support explicit funding-card/payment verification, recording a supported receipt-first purchase, reviewing item identity, and allocating reviewed items to accounts. |
| `/super/charges` | Reconciliation of receipts against supermarket issuer charges/purchases, missing receipts, unmatched/ambiguous candidates, and manual link/unlink actions. Both financial purchase links and historical source associations are supported without duplicate spending. |
| `/super/review` | Canonical product review/editing: name, department, unit, reviewed status, merge identities, move a chain article code, and rematch products. Printed descriptions/codes and source amounts remain intact. Identity-affecting operations can invalidate earlier item approval and require review again. |

### Data management and accounting inspection

| Route | Implemented capability and interpretation |
| --- | --- |
| `/upload` | Statement PDF upload and history, parser/setup errors, import summary, stale IPC notice, duplicate/revision/review feedback, and explicit actual-card selection for PostgreSQL. Supported layouts are BBVA Visa, BBVA Mastercard, and Mercado Pago credit card. |
| `/review` | Unclassified merchant/purchase review; optional AI proposals; human accept/reject; account selection; selected-purchase/future-rule actions; and preview/explicit confirmation for matching-history changes. Proposals are suggestions, not automatic financial acceptance. |
| `/accounting` | Native account balances, posted journals with debit/credit lines and effective/recorded dates, source-evidence links, opening coverage/reconciliation disclosures, unresolved clearing explanation, and separate expense/debt/repayment values for custom groups. It is ledger inspection, not a complete investment/net-worth suite. |
| `/accounting/settings` | Rename accounts, restore built-in labels, rename built-in groups, and create/edit nonadditive custom account groups with selected membership. Custom names are shared literally across English/Spanish. |
| `/accounting/evidence/[id]` | Source admission status and recorded timestamp, original document access, selected printed source line, and extracted JSON. Links can originate in a journal or a report drill. |

### Shared controls and localization

Where appropriate, URLs preserve spend basis, value basis, tax allocation, granularity, and period across navigation. The parameter values are `spend=accrual|cash`, `value=real|nominal|usd`, `tax=excl|incl`, and `g=month|quarter|year|all`. Defaults are purchase/acquisition basis, real pesos, tax excluded, and monthly grouping. On PostgreSQL, `accrual` maps to supported purchase facts and `cash` maps to billed facts; `cash` does not mean actual bank cash flow.

Controls are route-specific. Calendar/habits/pace use acquisition timing. Installment burden uses billed timing. Bank/taxes/credits have value controls without a purchase-basis toggle. Float is a real-peso estimate. Receipt list/detail and matching display printed nominal ARS. Supermarket analytics offer value conversion without installment or issuer-tax controls. Changing granularity clears an incompatible selected period.

English is the default and Spanish is selectable through a remembered cookie. Built-in accounts/groups and accounting interactions use stable identities with translated labels/messages. Merchant names, product/source text, custom names, and original evidence are not translated into different financial facts. Forms retain actionable errors and entered values where implemented.

## Import and review workflows

### Credit-card statements

1. The user uploads a PDF and, on PostgreSQL, selects the configured actual card.
2. The server validates a safe PDF filename, `%PDF-` signature, and a **10 MiB** limit, then invokes the configured Python parser using an explicit interpreter.
3. The parser selects a supported layout and extracts periods, balances, totals, terms, future schedules, and individual transactions. Its full output also includes issuer product/account/cardholder fields, additional period/balance/limit/rate fields where printed, account-summary evidence for BBVA, and per-line `voucher`, `raw_line`, and `block_cardholder`. These extra source properties must be retained: the narrower `StatementJson` declaration in the appendix is only the integrity/query projection, not an exhaustive parser schema. Mercado Pago requires a year in the filename, derives yearless dates from it, and calculates its future ARS schedule from remaining equal installments. A parsed JSON payload that reaches admission is retained alongside the original PDF.
4. PostgreSQL verifies that supplied parsed JSON agrees with retained raw JSON, requires application revision metadata, and stores both as verified content-addressed objects.
5. Exact duplicate evidence is a no-op for new postings. A revised logical statement is retained as a pending revision and review rather than silently replacing accepted financial facts. The JSON importer retains conflicting declared totals or unsupported brands as pending evidence when those inputs reach it. The web upload first invokes the stricter PDF parser: an unknown layout, unreadable row, missing filename year for Mercado Pago, or parser-level total failure can abort before admission and create no persisted source revision. Distinguish this extraction error from a pending document and from a financial review on an accepted source.
6. Accepted rows are assessed by actual card, currency, date, occurrence, voucher where present, installment position/count, identity evidence, and financial nature.
7. Supported ordinary one-off purchases can post automatically using the current merchant account rule, otherwise Unallocated. Known purchases receive billing events. Supported opening obligations can receive later billing without another purchase. Recognized repayments and supported costs use their own postings.
8. Ambiguous currency lines, missing dates, unknown principal/history, recoverability questions, unsupported financial nature, and unlinked credits become explicit reviews. Not every printed line is a posted journal merely because parsing succeeded.
9. The import also attempts safe receipt reconciliation. Replaying the import must not duplicate financial events or erase existing item allocations/review decisions.

The legacy SQLite ingest has different replacement behavior: it replaces filename or brand/closing-date statement rows transactionally, rebuilds transactions/schedules/alerts, and preserves charge associations through stable fingerprints. Superseded statement PDFs are archived. Do not apply that destructive row-replacement model to the PostgreSQL ledger.

### Coto receipt extraction and exact verification

Receipt uploads accept PDF bytes up to **40 MiB**. Receipt filenames carry no identity. MuPDF renders pages; the OCR wrapper handles tall/narrow pages with overlapping horizontal slices, maps text boxes back into whole-page coordinates, and removes overlap duplicates. Scale attempts are `3`, `2`, and `1.5`. The local OCR child has a 180-second timeout and bounded output. Apple Vision recognition uses Spanish/English source recognition independently of UI language.

The parser extracts header/fiscal/payment data, items, article codes, EANs, quantities, units, printed unit prices, line totals, discount labels/tags, footer totals, savings, offers, and notes. The verifier independently requires:

- a read date and fiscal ticket number;
- at least one item and a known total for every item;
- `sum(item gross totals) = printed subtotal`;
- `sum(signed item discounts) = printed discounts`;
- `subtotal + signed discounts = printed total`, exactly to the cent.

Printed unit-price multiplication, total-savings differences, and offer-summary differences can be warnings. They are distinct from the exact subtotal/discount/total admission gate.

A failed OCR attempt cannot become a financial purchase. PostgreSQL retains its original PDF, extraction/transcript, verification result, rejected revision, and review. The user can correct the row transcript and retry without OCR; the original and corrected transcripts remain separate immutable objects. An accepted receipt is detected before rerunning OCR on a duplicate upload, so an old failed OCR extraction cannot undo an accepted correction.

Passing arithmetic does not approve product identity, prove the funding card, or allocate expense. Valid accepted receipt evidence can exist while those decisions remain unresolved.

### Product identity and allocation

Product matching uses the chain/SKU ownership first, an ordered description rule second, and otherwise creates a product requiring review. Canonical products have name, department, `un|kg` unit, reviewed status, and merge redirect. A receipt item separately records its match method and review status. Code movement, product updates, and merges preserve history and can invalidate affected approvals.

Packaged weight in a description does not make an item sold by the unit into a weighed kilogram sale. The parser distinguishes explicit per-kg/fractional sales from packaged mass; a narrowly supported audited `kg` to `un` interpretation exists for earlier accepted evidence. It does not rewrite printed quantity or amount.

Allocations can cover selected reviewed receipt items at their exact net amounts. The uncovered remainder stays Unallocated. Aggregate receipt allocation requires complete applicable item identity approval and exact conservation of the total. When allocation changes a posted purchase, the correction mechanism reclassifies the same principal; no second shopping expense is added.

### Receipt and statement convergence

A receipt can precede its statement. A supported receipt-first acquisition requires explicit actual card/payment verification and compatible payment evidence. The future statement then bills the same purchase. A statement can also precede its receipt; a compatible receipt links to the existing purchase.

Candidate matching uses retailer identity, dates within **three days**, compatible native ARS amounts, installment evidence, and ownership. For legacy/historical first-installment matching, `abs(installment cents × count − receipt total cents) <= count × (count − 1)` permits the documented installment rounding remainder. This arithmetic corroborates a candidate; it does not by itself prove a general original principal.

Multiple candidates, amount/card conflicts, already-owned charges, and pre-opening boundaries require review. A receipt can instead be associated with a retained historical issuer source without creating a posted purchase. Link/unlink history remains separate from source evidence and from financial recognition. Unlinking an association is not deleting the underlying purchase journal.

### Merchant proposals and merging

Merchant normalization removes source-specific noise and retained aliases/redirects consolidate names. Ordered first-match substring rules determine account/purpose. Manual merchant merging affects the matching family of merchant associations and preserves the original issuer descriptions.

AI proposals are optional and require `ANTHROPIC_API_KEY`. Requests contain sanitized merchant-name strings only, at most **200** unique sanitized names per batch. Runs of six or more digits are stripped, and names still resembling amounts, exchange-rate/payment wording, or percentages are refused. Amounts, dates, card/account numbers, cardholder names, and documents are not included in the intended classification payload. Python parser/OCR children receive an environment allowlist that excludes the Anthropic key.

Suggestions carry high/low confidence and retain what was sent. The LLM returns a legacy category/subcategory suggestion; the accounting workflow requires a human to choose/accept the appropriate current account and scope. Rejected suggestions are remembered. A service failure or missing key does not make the ordinary financial reports depend on AI.

## Report calculations and interpretation

### Time and valuation

The issuer **cycle month** is the month containing the midpoint between previous and current closing dates. Without previous closing, legacy extraction uses a 30-day approximation. PostgreSQL acquisition reports group supported acquisitions by effective acquisition month, while billed reports use statement cycle month. Calendar/habits/pace use purchase dates and per-card windows. Receipt analytics use the receipt calendar month.

Ordinary nominal/real peso spending omits native USD contributions from its aggregate, although native USD evidence can remain inspectable. USD view combines native USD with ARS divided by the monthly MEP rate. The separate currency lens converts USD to pesos when requested.

Real ARS amount is `nominal ARS × IPC(latest available month) / IPC(report month)`. IPC/MEP lookup uses the exact month or nearest earlier available value; requests before all history or empty reference tables fail with a data/setup error. Reference tables are cached in the process. Updating/reloading them can change analytical historical valuations without changing native accounting facts.

The optional issuer-tax multiplier is an analytical statement-level allocation. Its base is net billed ARS plus MEP-valued native USD, and its numerator is included issuer ARS costs, excluding descriptions starting `DEVOLUCION`. With a positive base, `multiplier = 1 + costs/base`; it applies to signed spending. A receipt-first purchase with no supporting billing does not receive invented issuer tax. The dedicated tax report uses actual issuer cost evidence. Neither calculation proves recoverability or actual FX settlement.

### Identity, totals, and comparisons

PostgreSQL reporting derives current accepted ledger allocations, supported historical acquisitions, and unresolved issuer observations while avoiding duplicate observations for already represented postings. Reader facts identify their origin (`ledger`, `issuer_observation`, or `historical_acquisition`) and coverage (`complete`, `opening`, or `uncertain`). Historical analytical spending need not equal the expense balance in opening-mode books.

Signed credits can net against purchases, subject to linkage semantics. Unlinked payment-section credits do not become purchase expense. Merchant concentration drops nonpositive net merchant totals; its positive-only denominator may differ from an all-merchant signed total. Ticket statistics count purchase identities rather than allocation rows. Percentage changes with a zero prior value are undefined. Period comparisons follow available buckets rather than synthesizing missing months.

### Recurrence and personal inflation

The detector excludes installment purchases and nets same-currency monthly merchant observations. It requires at least **four positive months** and **60 percent density** between the first and last occurrence. A merchant is lapsed after at least two observed cycle months since the last occurrence, relative to newest imported data rather than today's clock.

Price stability can qualify through repeated nominal observations within 1 percent in at least 25 percent of consecutive observations, or through CPI-adjusted median absolute deviation/median at most 8 percent for ARS. USD is assessed without peso deflation. Low-confidence frequent merchants remain variable recurring behavior. Currency migration is retained; a percentage change across incompatible currencies is undefined. There is no separate annual-subscription cadence model.

The personal inflation basket uses eligible recurring ARS merchants with exactly one positive purchase row in a month. It chains consecutive observed basket months using merchants shared between them: `new index = previous index × current matched total / previous matched total`. Indices start at 100; no overlap leaves the personal index flat.

### Alerts

Computed duplicate candidates are non-installment ARS purchases of at least **ARS 10,000**, with the same merchant/amount in the same statement within two days. A matching reversal can resolve the candidate by default. Recurring amount-jump flags require a real increase greater than **25 percent** between eligible single-row positive months. New-merchant flags apply in the latest observed cycle with net ARS spending of at least **ARS 10,000**.

PostgreSQL scopes computed identity by actual card and retains alert decisions as revisions. Source financial reviews are also surfaced, but routine item-identity and historical-classification events are handled in their corresponding workflows. Marking an alert reviewed does not change source amounts or automatically resolve an unsupported financial posting.

Legacy SQLite's ARS 1 integrity-alert tolerance and the Python parser's own tolerances are not the PostgreSQL exact declared-total admission rule or the receipt exact-cent gate. Do not describe a universal tolerance shared by all pipelines.

### Forecast, installments, float, and terms

The forecast begins after the latest relevant observed month and spans six months. It combines:

1. **Certain:** newest current source schedules per actual card: printed schedules for BBVA and locally projected remaining equal ARS installments for Mercado Pago. The chart layer name does not prove every projected amount is supported ledger principal.
2. **Expected:** active high-confidence ARS recurring merchants at their latest amounts.
3. **Estimated:** the range between minimum and maximum positive variable totals across up to six recent available months, excluding installment and selected recurring inputs.

The range is not a probabilistic confidence interval. Inflation is a trailing geometric monthly IPC rate. Nominal recurring/variable estimates grow with inflation; real values stay level, while fixed nominal installments erode in real terms. USD uses available MEP rather than forecasting depreciation. USD subscriptions are visible in recurrence but are not included as expected ARS recurring obligations. Forecast inputs do not all apply the shared tax control identically, and future taxes are not independently modeled.

Open-plan remaining principal is an analytical amount based on observed remaining installments. Keep it distinct from supported native unbilled ledger principal and unknown future commitment coverage.

Float gain uses the difference between CPI-restated purchase and modeled due-date values. Delays are weighted by nominal billed amount. Missing due date falls back to day 28 of the cycle; negative modeled delays are omitted, and unavailable future CPI uses the latest reference. Actual repayment attribution is a separate model.

Bank utilization uses statement balances, translating native USD through monthly MEP for that lens, divided by nominal purchase limits. Minimum-payment share uses ARS balance. Worst TEM is the largest reported effective monthly rate; real TEM is `(1 + TEM) / (1 + monthly IPC change) − 1`. Missing adjacent IPC or card coverage yields missing comparisons rather than invented values.

### Supermarket analytics

One shopping period is one receipt ordered by date/time/identity. Indicative monthly spend is **average receipt total × 4.33**, assuming weekly shopping, not an actual month aggregation. Signed discounts satisfy `net = gross + discounts`.

Repeated lines of the same canonical product in a receipt form one quantity-weighted appearance. Last price change compares the last two appearances even if intervening receipts omit the product. Analytical unit prices derive from gross/net totals and quantity rather than trusting OCR's printed unit price.

Gross and effective product indices start at 100. Each link values current quantities at current versus most recent earlier comparable product prices. New products do not influence that comparison; no comparable products leave the index flat. PostgreSQL requires reviewed canonical identities for trusted price comparisons, while raw totals/discounts remain available.

Promotion savings distinguish `M` (Mercado Pago), `A` (Coto), and mixed-tag items. An item's entire discount can enter the mixed bucket if both tags appear; this is not a precise sponsor-funding allocation. Frequency groups distinguish products in every receipt, repeated products, and one-time appearances; entered/left compares the last two baskets, not permanent lifetime arrival/departure.

Real/USD conversion uses receipt month and rounds individual monetary fields to cents before analytics. Independently rounded parts can differ slightly from a converted receipt total. Admission always verifies original printed ARS.

## Legacy SQLite schema and behavior

SQLite retains **18 application tables**, defined in `web/src/lib/db.ts`. Its exact initial DDL is in the appendix. Startup also widens older statements with bank-term columns, adds/backfills transaction fingerprints, and can seed empty rule/alias/product tables from legacy JSON. These operations are not the PostgreSQL migration runner.

| Table | Main fields and relationships |
| --- | --- |
| `statements` | Integer ID, unique file, brand, closing/cycle/due/previous-closing dates, native balances, minimum, previous balance, purchase limit, TNA/TEM. Legacy statement amounts are `REAL`, unlike ledger minor units. |
| `transactions` | Integer ID; statement FK with cascade; section, date, printed description, normalized merchant, category/subcategory, ARS/USD, installment number/count, stable fingerprint. |
| `upcoming_installments` | Statement/month composite key, ARS amount, cascade from statement. |
| `alerts` | Statement FK, kind/message, expected/actual amounts. |
| `alert_reviews` | Stable derived string key, open/reviewed/dismissed state; deliberately no transient alert FK. |
| `category_rules` | Explicit position primary key, unique match, category/subcategory; order determines first match. |
| `category_proposals` | Position, unique merchant, sanitized sent text, category/subcategory, high/low confidence. |
| `rejected_merchants` | Position and unique merchant. |
| `merchant_aliases` | Explicit ordered position, unique prefix match, canonical alias. |
| `receipts` | Integer ID; chain/branch, date/time, unique fiscal number and file hash, file path, fiscal/payment metadata, integer subtotal/discount/total cents, header/verification JSON, OCR/corrected provenance, scale, creation time. |
| `receipt_items` | Integer ID; receipt FK/cascade; unique receipt/position; printed description, promotion flag, SKU/EAN, quantity thousandths, unit, printed unit-price cents, gross line-total cents. |
| `receipt_discounts` | Integer ID; item FK/cascade; position, label, `M|A` tag, signed cents. |
| `receipt_transcripts` | Composite receipt/kind key; OCR/corrected text. |
| `products` | Integer ID, unique name, department, unit, needs-review flag, creation time. |
| `product_codes` | Chain/SKU composite key, optional EAN, product FK. |
| `product_rules` | Explicit position, chain/match uniqueness, product FK. |
| `product_matches` | Receipt-item primary key/FK; product FK; `code|rule|auto` method. |
| `receipt_charge_links` | Unique receipt FK and unique stable charge fingerprint, auto/manual method, creation time. Fingerprint has no transaction FK because transaction row IDs change on re-ingest. |

Legacy `cash` reports sum billed purchase rows; legacy `accrual` groups merchant/date/installment-count series and recognizes earliest observed installment amount times remaining installment count. That is an approximation, can start with incomplete principal, and can collide across cards. The PostgreSQL identity/evidence model deliberately replaces that behavior. Legacy broad reclassification/re-ingest and review-key cleanup also differ from append-only accounting decisions.

## HTTP interfaces and mutation boundaries

The app exposes a small internal route-handler surface, with most editing done through server actions rather than a public CRUD API:

| Method and route | Input and result |
| --- | --- |
| `POST /api/upload` | Multipart `file`; PostgreSQL also requires `cardId`. Returns parser/import summary, duplicate/review state, cycle, counts, and stale-IPC feedback; structured errors on failure. |
| `POST /api/receipts` | Multipart PDF `file`. Returns accepted receipt summary or a 422 verification failure with report, transcript, hash, scale, and PostgreSQL source revision where available. |
| `POST /api/receipts/corrected` | JSON `{sha256, rowsText}` referencing retained evidence. Re-parses/verifies the corrected transcript and returns a receipt summary or structured rejection. |
| `GET /api/accounting/documents/[hash]` | PostgreSQL-only retained object access. Validates the hash, resolves a persisted reference, verifies bytes through document storage, and serves PDF inline or other objects as attachments with private/no-store and nosniff headers. |

The document hash route is evidence retrieval within the app's access boundary, not a signed-share or user-authentication feature. A hash-shaped string is not authorization to read an arbitrary filesystem path.

Server actions handle account/group names, purchase/source classification, merchant proposals/merges, alert state, product operations, receipt linking/unlinking, funding verification, item identity, and allocations. Domain/operator use cases additionally cover opening obligations, historical refund posting, reconstruction, and acceptance/recovery operations. Do not assume every domain function has a dedicated UI button or external API endpoint.

## Reference data and operations

IPC and MEP are JSON month-to-number tables under `referenceDir()`. `TARJETAS_REFERENCE_DIR` selects an absolute separate root; the legacy default is repository `data/`. The IPC script requests the configured national general index series from datos.gob.ar. The MEP script requests bolsa sell quotes from ArgentinaDatos and writes monthly averages rounded to two decimals. Both are explicit operator scripts with atomic publication, not upload-triggered refreshes or ledger FX feeds.

Interpreter selection uses `TARJETAS_PYTHON` or repository `.venv/bin/python3`. Parser/OCR script and legacy PDF/JSON paths also have environment overrides. PostgreSQL credentials, private financial documents, and local runtime data are not part of this prompt. The tracked `web/scripts/start-web.sh` can delegate to the installation's private launcher and otherwise starts a separately configured development checkout.

Available package scripts include `dev`, `build` using Next's webpack build, `start`, `test`, `test:receipts`, `ingest`, `fetch-ipc`, `fetch-mep`, `build-products-seed`, `accounting`, and `test:accounting:pg`.

The accounting CLI implements `migrate`, `demo`, `reconstruct`, and `release-check` with explicit `--target test|staging`; demo is restricted to test and release-check to staging. It uses explicit target URLs and guards against the default database URL. This is not an unrestricted live-data administration UI. Other scripts provide report oracles/comparisons/decision verification, signoff, OCR benchmark, and restore checks.

### Backup and reconstruction

`scripts/accounting_backup.py` creates/verifies/restores the PostgreSQL accounting archive: a custom PostgreSQL dump, immutable objects, pending evidence, reference files, application/schema metadata, and hashes/sizes. Required object identities come from persisted metadata, not merely a filesystem listing. `scripts/backup.py` separately supports legacy SQLite archives; the formats are not interchangeable.

A consistent archive requires stopping application/import/correction/reference writers while the database and files are captured. Archive SHA-256 is retained and checked externally. Recovery targets a fresh empty database and empty private roots; it does not clear an existing database. Credentials and application code are not included, and archive encryption/off-machine retention are not automatically provided.

The application restore checker compares migration state, table row identities/digests, native balances, exact source bytes, guards, revision/correction/link chains, opening obligations, attribution conservation, pending/review state, and relocated roots. A successful byte restore alone is not financial migration approval.

Reconstruction retains original legacy rows/objects and ID mappings, separates unknown cases into review, compares reports, supports explicit opening evidence, and writes a report rather than relabeling incomplete history as complete. Release checks cover preservation/target scenarios, source differences, runtime, recovery, and acceptance evidence. After new PostgreSQL activity, switching a flag to an old SQLite snapshot is not lossless rollback.

## Current boundaries and future scope

Keep these boundaries explicit when discussing capabilities:

- Bank/wallet registers, bank statement ingestion, actual payment-source reconciliation, general transfers, and cross-currency settlement are deferred. Unresolved clearing is not a confirmed bank account.
- MEP display conversion is not actual foreign-exchange settlement, realized FX gains/losses, or tax-accounting valuation.
- There is no budgeting/envelope module, investment/portfolio module, inventory valuation, depreciation scheduler, or complete net-worth/balance-sheet reporting suite merely because double-entry account types exist.
- Statement parsers cover specific supported layouts, and the receipt parser covers Coto. Arbitrary banks, arbitrary retailer formats, email scraping, and automatic bank synchronization are not implemented capabilities.
- Receipt OCR depends on Apple Vision on macOS. External OCR and a general Linux OCR adapter are not part of the current implementation.
- PDF upload size limits exist, but receipt rendering does not yet impose an independent raster-memory cap. Long OCR work is performed through the current request/pipeline architecture, not a general distributed processing queue.
- There is no application login, multiuser ownership, public financial REST API, scheduled in-app reference refresh, public sharing workflow, or hosted backup/PITR service configured by this code.
- Classification suggestions require human acceptance. Exact arithmetic does not prove a product identity, funding source, recoverable tax, or full financed principal.
- Source review status, posted ledger state, historical analytical coverage, and runtime/deployment status are different dimensions. Do not turn a dated test report into a claim about a currently running deployment or current private balances.

## Instructions for using this context

When answering a follow-up, preserve the distinction between source evidence, accepted financial postings, classification decisions, and report projections. Explain native amounts and dates before any display conversion. Trace a proposed change to the layer that owns it, and preserve original evidence, audit history, idempotency, card identity, exact amounts, and the separate English/Spanish interface.

If repository access is available, use current owning code to resolve drift. Prefer migrations and implementation/types over historical plans. `docs/current-state/` contains a useful pre-accounting preservation baseline, but some of its SQLite-only boundaries are superseded. `docs/accounting/implementation-status.md` records dated migration and follow-up results; its record counts, test totals, balances, and delivery statements are historical rather than current database facts.

Useful owning sources are `web/src/lib/backend.ts`; `web/src/lib/accounting/{model,read-model,port,postgres,reader-postgres,evidence,evidence-port,statement-import,receipt-import,linking,historical-links,historical-refunds,source-classification,review,catalog,catalog-service,opening-obligations,use-cases}.ts`; `web/src/lib/accounting/reports/`; `web/src/lib/receipts/{parse,verify,facts,analytics,charges}.ts`; `web/src/lib/{db,scope,chrome,recurring,projection,cpi,mep,llm}.ts`; the actual page/action files; and the backup/operator scripts.

The appendices below preserve exact source schemas and principal entity definitions so this prompt can also be used without repository access. They are reference material, not instructions to execute SQL or write financial records.


## Exact PostgreSQL migration SQL

These are the repository migrations in numeric order. Later `ALTER TABLE` statements extend earlier definitions. The SQL includes immutability and posting guards because those constraints are part of the data model.

### Migration 001 Ledger

Source: `web/src/lib/accounting/migrations/001-ledger.sql`.

```sql
CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cards (id text PRIMARY KEY);
CREATE TABLE accounts (
 id text PRIMARY KEY, parent_id text REFERENCES accounts(id), type text NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
 label_key text, custom_name text, currency text CHECK(currency IN ('ARS','USD')), primary_purpose_id text,
 posting boolean NOT NULL, enabled boolean NOT NULL, CHECK(label_key IS NOT NULL OR nullif(trim(custom_name),'') IS NOT NULL)
);
CREATE TABLE evidence (id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('synthetic','statement','receipt')), metadata jsonb NOT NULL);
CREATE TABLE commands (key text PRIMARY KEY, card_id text REFERENCES cards(id), digest text NOT NULL, result jsonb NOT NULL);
CREATE TABLE journals (
 id text PRIMARY KEY, command_key text NOT NULL, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')),
 effective_date date NOT NULL, recorded_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('purchase','billing','repayment','credit','cost','opening','reversal','replacement')),
 reverses_id text REFERENCES journals(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted'))
);
CREATE TABLE journal_lines (
 journal_id text NOT NULL REFERENCES journals(id), ordinal integer NOT NULL CHECK(ordinal >= 0), account_id text NOT NULL REFERENCES accounts(id),
 debit_minor bigint NOT NULL CHECK(debit_minor BETWEEN 0 AND 9007199254740991), credit_minor bigint NOT NULL CHECK(credit_minor BETWEEN 0 AND 9007199254740991),
 purchase_id text, purpose_id text, PRIMARY KEY(journal_id,ordinal),
 CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE TABLE journal_evidence (journal_id text NOT NULL REFERENCES journals(id), evidence_id text NOT NULL REFERENCES evidence(id), PRIMARY KEY(journal_id,evidence_id));
CREATE FUNCTION guard_account() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.parent_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.parent_id AND type=NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
   IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM accounts WHERE id=NEW.parent_id UNION SELECT a.id,a.parent_id FROM accounts a JOIN ancestors p ON a.id=p.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'account_cycle'; END IF;
   IF EXISTS(SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=NEW.parent_id AND j.status='posted') THEN RAISE EXCEPTION 'posted_account_not_leaf'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=OLD.id AND j.status='posted') AND (NEW.type IS DISTINCT FROM OLD.type OR NEW.currency IS DISTINCT FROM OLD.currency OR NOT NEW.posting) THEN RAISE EXCEPTION 'posted_account_invariant'; END IF;
 IF TG_OP='UPDATE' AND NEW.type IS DISTINCT FROM OLD.type AND EXISTS(SELECT 1 FROM accounts WHERE parent_id=OLD.id AND type<>NEW.type) THEN RAISE EXCEPTION 'invalid_account_parent'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION guard_account();
CREATE FUNCTION guard_journal_child() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE state text;
BEGIN
 SELECT status INTO state FROM journals WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.journal_id ELSE NEW.journal_id END FOR UPDATE;
 IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF TG_OP='UPDATE' THEN
   SELECT status INTO state FROM journals WHERE id=OLD.journal_id FOR UPDATE;
   IF state='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION guard_journal_child();
CREATE TRIGGER evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_evidence FOR EACH ROW EXECUTE FUNCTION guard_journal_child();
CREATE FUNCTION guard_journal() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE count_lines bigint; deb numeric; cred numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF TG_OP='INSERT' THEN
   IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'journal_requires_draft'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.status='posted' THEN RAISE EXCEPTION 'immutable_posted_journal'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.status='posted' THEN
   SELECT count(*),sum(debit_minor),sum(credit_minor) INTO count_lines,deb,cred FROM journal_lines WHERE journal_id=NEW.id;
   IF count_lines<2 OR deb IS NULL OR deb<>cred OR deb<=0 OR deb>9007199254740991 THEN RAISE EXCEPTION 'unbalanced_journal'; END IF;
   IF NOT EXISTS(SELECT 1 FROM journal_evidence WHERE journal_id=NEW.id) THEN RAISE EXCEPTION 'missing_evidence'; END IF;
   IF EXISTS(SELECT 1 FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=NEW.id AND (NOT a.enabled OR NOT a.posting OR (a.currency IS NOT NULL AND a.currency<>NEW.currency) OR EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id=a.id))) THEN RAISE EXCEPTION 'invalid_posting_account'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION guard_journal();
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN RAISE EXCEPTION 'immutable_record'; END $$;
CREATE TRIGGER command_immutable BEFORE UPDATE OR DELETE ON commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(1);
```

### Migration 002 Purchases

Source: `web/src/lib/accounting/migrations/002-purchases.sql`.

```sql
CREATE TABLE purchases (id text PRIMARY KEY, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')));
CREATE TABLE purchase_versions (
 purchase_id text NOT NULL REFERENCES purchases(id),version integer NOT NULL CHECK(version>0),journal_id text NOT NULL UNIQUE REFERENCES journals(id),principal_minor bigint NOT NULL CHECK(principal_minor BETWEEN 1 AND 9007199254740991),payload jsonb NOT NULL,PRIMARY KEY(purchase_id,version)
);
CREATE TABLE billings (
 id text PRIMARY KEY, purchase_id text REFERENCES purchases(id),card_id text NOT NULL REFERENCES cards(id),currency text NOT NULL CHECK(currency IN ('ARS','USD')),installment integer NOT NULL CHECK(installment>0),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),journal_id text NOT NULL UNIQUE REFERENCES journals(id),payload jsonb NOT NULL,UNIQUE(purchase_id,installment)
);
CREATE TABLE billed_components (id text PRIMARY KEY,billing_id text NOT NULL REFERENCES billings(id),purpose_id text,minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991));
CREATE TABLE payments (id text PRIMARY KEY,card_id text NOT NULL REFERENCES cards(id),currency text NOT NULL CHECK(currency IN ('ARS','USD')),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),journal_id text NOT NULL UNIQUE REFERENCES journals(id),payload jsonb NOT NULL);
CREATE TABLE attributions (id text PRIMARY KEY,payment_id text NOT NULL REFERENCES payments(id),component_id text NOT NULL REFERENCES billed_components(id),purpose_id text,minor bigint NOT NULL CHECK(minor BETWEEN 1 AND 9007199254740991),method text NOT NULL CHECK(method IN ('issuer','oldest_billed_first')),revision integer NOT NULL CHECK(revision>0),UNIQUE(payment_id,component_id,revision));
CREATE TABLE linked_credits (id text PRIMARY KEY,purchase_id text NOT NULL REFERENCES purchases(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id),amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),payload jsonb NOT NULL);
CREATE TRIGGER purchase_immutable BEFORE UPDATE OR DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER purchase_version_immutable BEFORE UPDATE OR DELETE ON purchase_versions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER billing_immutable BEFORE UPDATE OR DELETE ON billings FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER component_immutable BEFORE UPDATE OR DELETE ON billed_components FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER attribution_immutable BEFORE UPDATE OR DELETE ON attributions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER linked_credit_immutable BEFORE UPDATE OR DELETE ON linked_credits FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(2);
```

### Migration 003 Corrections

Source: `web/src/lib/accounting/migrations/003-corrections.sql`.

```sql
CREATE TABLE correction_links (id text PRIMARY KEY,purchase_id text NOT NULL REFERENCES purchases(id),from_version integer NOT NULL,to_version integer NOT NULL,reversal_journal_id text NOT NULL UNIQUE REFERENCES journals(id),replacement_journal_id text NOT NULL UNIQUE REFERENCES journals(id),reason text NOT NULL CHECK(length(trim(reason))>0),recorded_at timestamptz NOT NULL,UNIQUE(purchase_id,to_version),FOREIGN KEY(purchase_id,from_version) REFERENCES purchase_versions(purchase_id,version),FOREIGN KEY(purchase_id,to_version) REFERENCES purchase_versions(purchase_id,version),CHECK(to_version=from_version+1));
CREATE TABLE component_revisions (id text PRIMARY KEY,component_id text NOT NULL REFERENCES billed_components(id),billing_id text NOT NULL REFERENCES billings(id),revision integer NOT NULL CHECK(revision>0),purpose_id text,minor bigint NOT NULL CHECK(minor BETWEEN 0 AND 9007199254740991),purchase_date date NOT NULL,UNIQUE(component_id,revision));
CREATE TRIGGER correction_immutable BEFORE UPDATE OR DELETE ON correction_links FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER component_revision_immutable BEFORE UPDATE OR DELETE ON component_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE credit_revisions (id text PRIMARY KEY,credit_id text NOT NULL REFERENCES linked_credits(id),purchase_version integer NOT NULL CHECK(purchase_version>1),reversal_journal_id text NOT NULL UNIQUE REFERENCES journals(id),replacement_journal_id text NOT NULL UNIQUE REFERENCES journals(id),recorded_at timestamptz NOT NULL,payload jsonb NOT NULL,UNIQUE(credit_id,purchase_version));
CREATE TRIGGER credit_revision_immutable BEFORE UPDATE OR DELETE ON credit_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE attribution_revisions (payment_id text NOT NULL REFERENCES payments(id),revision integer NOT NULL CHECK(revision>0),unapplied_minor bigint NOT NULL CHECK(unapplied_minor BETWEEN 0 AND 9007199254740991),PRIMARY KEY(payment_id,revision));
CREATE TRIGGER attribution_revision_immutable BEFORE UPDATE OR DELETE ON attribution_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(3);
```

### Migration 004 Evidence

Source: `web/src/lib/accounting/migrations/004-evidence.sql`.

```sql
CREATE TABLE source_documents (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 relative_path text NOT NULL CHECK(relative_path=sha256),
 byte_length bigint NOT NULL CHECK(byte_length BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE source_revisions (
 id text PRIMARY KEY REFERENCES evidence(id), ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, source_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('statement','receipt')), card_id text REFERENCES cards(id),
 document_hash text NOT NULL REFERENCES source_documents(sha256), raw_object_hash text REFERENCES source_documents(sha256),
 previous_revision_id text REFERENCES source_revisions(id), recorded_at timestamptz NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 app_revision text NOT NULL CHECK(length(trim(app_revision))>0), payload jsonb NOT NULL,
 UNIQUE(kind,document_hash,payload_digest), CHECK(kind<>'statement' OR card_id IS NOT NULL),
 CHECK(COALESCE(payload->>'admission','') IN ('accepted','rejected','pending'))
);
CREATE FUNCTION guard_source_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.previous_revision_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM source_revisions WHERE source_key=NEW.source_key) THEN RAISE EXCEPTION 'missing_previous_revision'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM source_revisions WHERE id=NEW.previous_revision_id AND kind=NEW.kind AND (source_key=NEW.source_key OR document_hash=NEW.document_hash AND (NEW.kind='receipt' AND payload->>'admission'='rejected' OR NEW.kind='statement' AND card_id=NEW.card_id AND NEW.payload->>'admission'='pending'))) THEN RAISE EXCEPTION 'invalid_previous_revision'; END IF;
   IF EXISTS(SELECT 1 FROM source_revisions WHERE previous_revision_id=NEW.previous_revision_id) THEN RAISE EXCEPTION 'source_revision_fork'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_revision_guard BEFORE INSERT ON source_revisions FOR EACH ROW EXECUTE FUNCTION guard_source_revision();
CREATE INDEX source_revisions_key ON source_revisions(source_key);
CREATE TABLE source_lines (
 id text PRIMARY KEY REFERENCES evidence(id), revision_id text NOT NULL REFERENCES source_revisions(id),
 occurrence integer NOT NULL CHECK(occurrence>=1), payload jsonb NOT NULL, legacy_fingerprint text,
 UNIQUE(revision_id,occurrence)
);
CREATE TABLE source_import_commands (key text PRIMARY KEY, digest text NOT NULL, result jsonb NOT NULL);
CREATE TABLE source_purchase_identities (
 source_line_id text NOT NULL REFERENCES source_lines(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')),
 purchase_id text NOT NULL REFERENCES purchases(id), card_id text NOT NULL REFERENCES cards(id), purchase_date date NOT NULL,
 payload jsonb NOT NULL, PRIMARY KEY(source_line_id,currency)
);
CREATE TABLE review_events (
 id text PRIMARY KEY, ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, subject_id text NOT NULL REFERENCES evidence(id), prior_decision_id text REFERENCES review_events(id),
 code text NOT NULL, params jsonb NOT NULL, source_line_ids jsonb NOT NULL CHECK(jsonb_typeof(source_line_ids)='array'),
 state text NOT NULL CHECK(state IN ('open','reviewed','dismissed')), recorded_at timestamptz NOT NULL
);
CREATE TRIGGER source_documents_immutable BEFORE UPDATE OR DELETE ON source_documents FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_revisions_immutable BEFORE UPDATE OR DELETE ON source_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_lines_immutable BEFORE UPDATE OR DELETE ON source_lines FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_commands_immutable BEFORE UPDATE OR DELETE ON source_import_commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_identities_immutable BEFORE UPDATE OR DELETE ON source_purchase_identities FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER source_reviews_immutable BEFORE UPDATE OR DELETE ON review_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- Search-path qualified by the owning migration transaction; the view belongs to that schema.
CREATE VIEW accounting_backup_metadata AS
SELECT jsonb_build_object(
 'app_revision', (SELECT app_revision FROM source_revisions ORDER BY ordinal DESC LIMIT 1),
 'schema_version', (SELECT max(version) FROM schema_migrations),
 'database', jsonb_build_object('path','database.dump','server_major',current_setting('server_version_num')::integer/10000),
 'source_references', COALESCE((SELECT jsonb_agg('objects/' || relative_path ORDER BY relative_path) FROM source_documents),'[]'::jsonb)
) AS metadata;
INSERT INTO schema_migrations(version) VALUES(4);
```

### Migration 005 Source facts

Source: `web/src/lib/accounting/migrations/005-source-facts.sql`.

```sql
CREATE TABLE statement_cycles (
 revision_id text PRIMARY KEY REFERENCES source_revisions(id), card_id text NOT NULL REFERENCES cards(id),
 closing_date date NOT NULL, period jsonb NOT NULL, UNIQUE(card_id,closing_date,revision_id)
);
CREATE TABLE statement_terms (revision_id text PRIMARY KEY REFERENCES source_revisions(id), payload jsonb NOT NULL);
CREATE TABLE issuer_schedules (revision_id text NOT NULL REFERENCES source_revisions(id), ordinal integer NOT NULL CHECK(ordinal>=1), payload jsonb NOT NULL, PRIMARY KEY(revision_id,ordinal));
CREATE TRIGGER statement_cycles_immutable BEFORE UPDATE OR DELETE ON statement_cycles FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER statement_terms_immutable BEFORE UPDATE OR DELETE ON statement_terms FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER issuer_schedules_immutable BEFORE UPDATE OR DELETE ON issuer_schedules FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(5);
```

### Migration 006 Reviews products

Source: `web/src/lib/accounting/migrations/006-reviews-products.sql`.

```sql
CREATE TABLE review_products (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991));
CREATE TABLE product_revisions (seq bigserial PRIMARY KEY,product_id bigint NOT NULL REFERENCES review_products(id),payload jsonb NOT NULL);
CREATE TABLE product_code_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL,product_id bigint GENERATED ALWAYS AS ((payload->>'productId')::bigint) STORED REFERENCES review_products(id));
CREATE TABLE product_match_revisions (seq bigserial PRIMARY KEY,id text NOT NULL REFERENCES source_lines(id),payload jsonb NOT NULL,product_id bigint GENERATED ALWAYS AS ((payload->>'productId')::bigint) STORED REFERENCES review_products(id));
CREATE TABLE merchant_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE merchant_purchase_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE merchant_rule_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE product_rule_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE proposal_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE alert_state_revisions (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE merchant_rejections (seq bigserial PRIMARY KEY,id text NOT NULL,payload jsonb NOT NULL);
CREATE TABLE review_decisions (seq bigserial PRIMARY KEY,id text NOT NULL UNIQUE,key text NOT NULL UNIQUE,digest text NOT NULL,subject_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('product_match','product_update','product_merge','move_code','merchant_merge','alert_state','proposal_accept','proposal_reject')),payload jsonb NOT NULL,prior_decision_id text REFERENCES review_decisions(id),recorded_at timestamptz NOT NULL,affected_ids jsonb NOT NULL);
CREATE TRIGGER product_revision_immutable BEFORE UPDATE OR DELETE ON product_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER product_code_revision_immutable BEFORE UPDATE OR DELETE ON product_code_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER product_match_revision_immutable BEFORE UPDATE OR DELETE ON product_match_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER merchant_revision_immutable BEFORE UPDATE OR DELETE ON merchant_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER merchant_purchase_revision_immutable BEFORE UPDATE OR DELETE ON merchant_purchase_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER merchant_rule_revision_immutable BEFORE UPDATE OR DELETE ON merchant_rule_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER product_rule_revision_immutable BEFORE UPDATE OR DELETE ON product_rule_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER proposal_revision_immutable BEFORE UPDATE OR DELETE ON proposal_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER alert_state_revision_immutable BEFORE UPDATE OR DELETE ON alert_state_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER merchant_rejection_immutable BEFORE UPDATE OR DELETE ON merchant_rejections FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER review_decision_immutable BEFORE UPDATE OR DELETE ON review_decisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(6);
```

### Migration 007 Catalog

Source: `web/src/lib/accounting/migrations/007-catalog.sql`.

```sql
CREATE TABLE catalog_commands (key text PRIMARY KEY,digest text NOT NULL,result jsonb NOT NULL);
CREATE TABLE account_name_revisions (id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),custom_name text CHECK(custom_name IS NULL OR length(trim(custom_name))>0),recorded_at timestamptz NOT NULL);
CREATE TABLE account_groups (id text PRIMARY KEY);
CREATE TABLE account_group_revisions (id text PRIMARY KEY,group_id text NOT NULL REFERENCES account_groups(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL,ordinal bigserial UNIQUE);
CREATE TRIGGER catalog_command_immutable BEFORE UPDATE OR DELETE ON catalog_commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER account_name_immutable BEFORE UPDATE OR DELETE ON account_name_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER group_revision_immutable BEFORE UPDATE OR DELETE ON account_group_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(7);
```

### Migration 008 Receipts

Source: `web/src/lib/accounting/migrations/008-receipts.sql`.

```sql
CREATE TABLE receipt_entities (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 chain text NOT NULL, fiscal_id text, UNIQUE(chain,fiscal_id)
);
CREATE TABLE receipt_entity_keys (chain text NOT NULL,identity_key text NOT NULL,receipt_id bigint NOT NULL REFERENCES receipt_entities(id),PRIMARY KEY(chain,identity_key));
CREATE TRIGGER receipt_entity_keys_immutable BEFORE UPDATE OR DELETE ON receipt_entity_keys FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION guard_receipt_entity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_receipt_entity'; END IF;
 IF NEW.id<>OLD.id OR NEW.chain<>OLD.chain OR OLD.fiscal_id IS NOT NULL AND NEW.fiscal_id IS DISTINCT FROM OLD.fiscal_id THEN RAISE EXCEPTION 'immutable_receipt_entity'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_entity_guard BEFORE UPDATE OR DELETE ON receipt_entities FOR EACH ROW EXECUTE FUNCTION guard_receipt_entity();
CREATE TABLE receipt_facts (
 revision_id text PRIMARY KEY REFERENCES source_revisions(id), receipt_id bigint NOT NULL REFERENCES receipt_entities(id), chain text NOT NULL, fiscal_id text,
 receipt_date date, total_minor bigint CHECK(total_minor BETWEEN -9007199254740991 AND 9007199254740991),
 original_rows_hash text NOT NULL REFERENCES source_documents(sha256), corrected_rows_hash text REFERENCES source_documents(sha256),
 payload jsonb NOT NULL
);
CREATE TABLE receipt_link_decisions (
 id text PRIMARY KEY, ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, key text NOT NULL UNIQUE, receipt_revision_id text NOT NULL REFERENCES receipt_facts(revision_id),
 purchase_id text REFERENCES purchases(id), card_id text REFERENCES cards(id), action text NOT NULL CHECK(action IN ('link','unlink')),
 previous_decision_id text REFERENCES receipt_link_decisions(id), recorded_at timestamptz NOT NULL, payload jsonb NOT NULL,
 CHECK(action<>'link' OR purchase_id IS NOT NULL)
);
CREATE FUNCTION guard_receipt_link() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.previous_decision_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM receipt_link_decisions WHERE receipt_revision_id=NEW.receipt_revision_id) THEN RAISE EXCEPTION 'stale_receipt_link'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM receipt_link_decisions WHERE id=NEW.previous_decision_id AND receipt_revision_id=NEW.receipt_revision_id) OR EXISTS(SELECT 1 FROM receipt_link_decisions WHERE previous_decision_id=NEW.previous_decision_id) THEN RAISE EXCEPTION 'stale_receipt_link'; END IF;
 END IF;
 IF NEW.action='link' AND EXISTS(
   SELECT 1 FROM receipt_link_decisions d WHERE d.purchase_id=NEW.purchase_id AND d.receipt_revision_id<>NEW.receipt_revision_id AND d.action='link'
   AND NOT EXISTS(SELECT 1 FROM receipt_link_decisions child WHERE child.previous_decision_id=d.id)
 ) THEN RAISE EXCEPTION 'purchase_already_linked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_link_guard BEFORE INSERT ON receipt_link_decisions FOR EACH ROW EXECUTE FUNCTION guard_receipt_link();
CREATE TRIGGER receipt_facts_immutable BEFORE UPDATE OR DELETE ON receipt_facts FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER receipt_links_immutable BEFORE UPDATE OR DELETE ON receipt_link_decisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(8);
```

### Migration 009 Reconstruction

Source: `web/src/lib/accounting/migrations/009-reconstruction.sql`.

```sql
-- Lossless migration provenance, separate from accepted accounting facts.
CREATE TABLE reconstruction_runs (
 id text PRIMARY KEY, source_digest text NOT NULL, configuration_digest text NOT NULL,
 cutoff_date date NOT NULL, mode text NOT NULL CHECK(mode IN ('historical','opening')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legacy_rows (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), table_name text NOT NULL,
 source_id text NOT NULL, row_hash text NOT NULL, payload jsonb NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('retained','review')),
 reason text, PRIMARY KEY(run_id,table_name,source_id)
);
CREATE TABLE legacy_objects (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), source_path text NOT NULL,
 sha256 text NOT NULL, byte_length bigint NOT NULL, object_path text NOT NULL,
 PRIMARY KEY(run_id,source_path)
);
CREATE TABLE legacy_id_map (
 run_id text NOT NULL REFERENCES reconstruction_runs(id), table_name text NOT NULL,
 source_id text NOT NULL, target_kind text NOT NULL, target_id text NOT NULL,
 PRIMARY KEY(run_id,table_name,source_id,target_kind,target_id),
 FOREIGN KEY(run_id,table_name,source_id) REFERENCES legacy_rows(run_id,table_name,source_id)
);
CREATE TABLE reconstruction_reports (run_id text PRIMARY KEY REFERENCES reconstruction_runs(id), payload jsonb NOT NULL);
CREATE TRIGGER legacy_rows_immutable BEFORE UPDATE OR DELETE ON legacy_rows FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER legacy_objects_immutable BEFORE UPDATE OR DELETE ON legacy_objects FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER legacy_map_immutable BEFORE UPDATE OR DELETE ON legacy_id_map FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE OR REPLACE VIEW accounting_backup_metadata AS
SELECT jsonb_build_object(
 'app_revision', (SELECT app_revision FROM source_revisions ORDER BY ordinal DESC LIMIT 1),
 'schema_version', (SELECT max(version) FROM schema_migrations),
 'database', jsonb_build_object('path','database.dump','server_major',current_setting('server_version_num')::integer/10000),
 'source_references', COALESCE((SELECT jsonb_agg(path ORDER BY path) FROM
   (SELECT 'objects/' || relative_path AS path FROM source_documents UNION SELECT 'objects/' || object_path FROM legacy_objects) refs),'[]'::jsonb)
) AS metadata;
INSERT INTO schema_migrations(version) VALUES(9);
```

### Migration 010 Historical links

Source: `web/src/lib/accounting/migrations/010-historical-links.sql`.

```sql
-- Evidence associations preserve historical matching independently of financial recognition.
CREATE TABLE historical_receipt_associations (
 id text PRIMARY KEY,key text NOT NULL UNIQUE,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 receipt_revision_id text NOT NULL REFERENCES receipt_facts(revision_id),
 source_line_id text NOT NULL REFERENCES source_lines(id),card_id text NOT NULL REFERENCES cards(id),
 action text NOT NULL CHECK(action IN ('link','unlink')),
 previous_decision_id text REFERENCES historical_receipt_associations(id),
 recorded_at timestamptz NOT NULL,payload jsonb NOT NULL
);
CREATE INDEX historical_receipt_association_history ON historical_receipt_associations(receipt_revision_id,ordinal);
CREATE FUNCTION guard_historical_receipt_association() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE receipt_amount bigint; source_amount numeric; count_installments integer;
BEGIN
 PERFORM pg_advisory_xact_lock(8581401);
 IF NEW.previous_decision_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM historical_receipt_associations WHERE receipt_revision_id=NEW.receipt_revision_id) THEN RAISE EXCEPTION 'stale_historical_association'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM historical_receipt_associations WHERE id=NEW.previous_decision_id AND receipt_revision_id=NEW.receipt_revision_id)
    OR EXISTS(SELECT 1 FROM historical_receipt_associations WHERE previous_decision_id=NEW.previous_decision_id) THEN RAISE EXCEPTION 'stale_historical_association'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM receipt_facts f JOIN source_revisions r ON r.id=f.revision_id WHERE f.revision_id=NEW.receipt_revision_id AND r.kind='receipt' AND r.payload->>'admission'='accepted')
    OR NOT EXISTS(SELECT 1 FROM source_lines l JOIN source_revisions r ON r.id=l.revision_id WHERE l.id=NEW.source_line_id AND r.kind='statement' AND r.card_id=NEW.card_id AND r.payload->>'admission'='accepted' AND l.payload->>'section'='purchases') THEN RAISE EXCEPTION 'historical_association_source_unavailable'; END IF;
 SELECT f.total_minor,(l.payload->>'ars')::numeric*100,coalesce((l.payload->>'installment_count')::integer,1) INTO receipt_amount,source_amount,count_installments FROM receipt_facts f CROSS JOIN source_lines l WHERE f.revision_id=NEW.receipt_revision_id AND l.id=NEW.source_line_id;
 IF receipt_amount IS NULL OR receipt_amount<=0 OR source_amount IS NULL OR source_amount<=0 OR source_amount<>round(source_amount) OR count_installments<1
    OR EXISTS(SELECT 1 FROM source_lines l WHERE l.id=NEW.source_line_id AND coalesce((l.payload->>'usd')::numeric,0)<>0)
    OR abs(source_amount*count_installments-receipt_amount)>count_installments*(count_installments-1)::numeric THEN RAISE EXCEPTION 'historical_association_evidence_mismatch'; END IF;
 IF NEW.action='link' AND EXISTS(SELECT 1 FROM historical_receipt_associations d WHERE d.source_line_id=NEW.source_line_id AND d.receipt_revision_id<>NEW.receipt_revision_id AND d.action='link' AND NOT EXISTS(SELECT 1 FROM historical_receipt_associations child WHERE child.previous_decision_id=d.id)) THEN RAISE EXCEPTION 'source_charge_already_linked'; END IF;
 IF NEW.action='unlink' AND NOT EXISTS(SELECT 1 FROM historical_receipt_associations d WHERE d.id=NEW.previous_decision_id AND d.action='link' AND d.source_line_id=NEW.source_line_id) THEN RAISE EXCEPTION 'invalid_historical_association'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_receipt_association_guard BEFORE INSERT ON historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION guard_historical_receipt_association();
CREATE TRIGGER historical_receipt_association_immutable BEFORE UPDATE OR DELETE ON historical_receipt_associations FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(10);
```

### Migration 011 Source classification

Source: `web/src/lib/accounting/migrations/011-source-classification.sql`.

```sql
ALTER TABLE review_decisions DROP CONSTRAINT review_decisions_kind_check;
ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_kind_check CHECK(kind IN ('product_match','product_update','product_merge','move_code','merchant_merge','alert_state','proposal_accept','proposal_reject','source_classification'));
INSERT INTO schema_migrations(version) VALUES(11);
```

### Migration 012 Opening obligations

Source: `web/src/lib/accounting/migrations/012-opening-obligations.sql`.

```sql
CREATE TABLE opening_obligations (id text PRIMARY KEY, card_id text NOT NULL REFERENCES cards(id), currency text NOT NULL CHECK(currency IN ('ARS','USD')), opening_journal_id text NOT NULL REFERENCES journals(id), payload jsonb NOT NULL);
CREATE TABLE opening_obligation_evidence (obligation_id text NOT NULL REFERENCES opening_obligations(id), evidence_id text NOT NULL REFERENCES evidence(id), PRIMARY KEY(obligation_id,evidence_id));
ALTER TABLE billings ADD COLUMN opening_obligation_id text REFERENCES opening_obligations(id);
ALTER TABLE billings ADD CONSTRAINT billing_one_origin CHECK (opening_obligation_id IS NULL OR purchase_id IS NULL);
CREATE UNIQUE INDEX opening_installment_identity ON billings(opening_obligation_id,installment) WHERE opening_obligation_id IS NOT NULL;
CREATE TRIGGER opening_obligation_immutable BEFORE UPDATE OR DELETE ON opening_obligations FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER opening_obligation_evidence_immutable BEFORE UPDATE OR DELETE ON opening_obligation_evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(12);
```

### Migration 013 Historical refunds

Source: `web/src/lib/accounting/migrations/013-historical-refunds.sql`.

```sql
ALTER TABLE review_decisions DROP CONSTRAINT review_decisions_kind_check;
ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_kind_check CHECK(kind IN ('product_match','product_update','product_merge','move_code','merchant_merge','alert_state','proposal_accept','proposal_reject','source_classification','historical_refund'));
INSERT INTO schema_migrations(version) VALUES(13);
```

## Exact principal entity schemas

These TypeScript declarations retain the application field names. SQL uses snake case in relational columns, while JSON payloads commonly use the TypeScript names below. Monetary `number` fields are checked safe integer minor units unless the declaration explicitly represents a display amount, source decimal, rate, or analytical value. Nullable values express missing or unresolved information; they must not silently become zero.

### Financial entities

Source: `web/src/lib/accounting/model.ts`.

```typescript
export type Currency = "ARS" | "USD";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = { id: string; parentId: string | null; type: AccountType; labelKey: string | null; customName: string | null; currency: Currency | null; primaryPurposeId: string | null; posting: boolean; enabled: boolean };
export type Line = { accountId: string; debitMinor: number; creditMinor: number; purchaseId: string | null; purposeId: string | null };
export type Journal = { id: string; commandKey: string; cardId: string; currency: Currency; effectiveDate: string; recordedAt: string; kind: "purchase" | "billing" | "repayment" | "credit" | "cost" | "opening" | "reversal" | "replacement"; reversesId: string | null; evidenceIds: string[]; lines: Line[] };
export type PostResult = { status: "posted" | "duplicate" | "review"; journalIds: string[]; reviewCode: string | null };
export type CommandReceipt = { key: string; digest: string; result: PostResult };
export type PurchaseInput = { key: string; purchaseId: string; cardId: string; currency: Currency; effectiveDate: string; recordedAt: string; evidenceIds: string[]; principalMinor: number; allocations: { accountId: string; purposeId: string; minor: number }[] };
export type BillingInput = { key: string; purchaseId: string; cardId: string; currency: Currency; installment: number; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[] };
export type PaymentInput = { key: string; cardId: string; currency: Currency; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[]; issuerAllocations: { componentId: string; minor: number }[] | null };
export type PurchaseVersion = PurchaseInput & { version: number; journalId: string };
export type BilledComponent = { id: string; purchaseId: string | null; cardId?: string; purposeId: string | null; currency: Currency; billedDate: string; purchaseDate: string; outstandingMinor: number };
export type Billing = { origin?: "opening_balance" | "opening_installment"; openingObligationId?: string; id: string; purchaseId: string | null; cardId: string; currency: Currency; installment: number; amountMinor: number; effectiveDate: string; purchaseDate: string; journalId: string; components: { id: string; purposeId: string | null; minor: number }[] };
export type Payment = PaymentInput & { id: string; journalId: string; unappliedMinor: number };
export type Attribution = { id: string; paymentId: string; componentId: string; purposeId: string | null; minor: number; method: "issuer" | "oldest_billed_first"; revision: number };
export type LinkedCreditInput = { key: string; purchaseId: string; cardId: string; currency: Currency; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[]; billedReductionMinor: number; unbilledReductionMinor: number };
export type LinkedCredit = LinkedCreditInput & { id: string; journalId: string; allocationReductions: { allocationIndex: number; minor: number }[]; componentReductions: { componentId: string; minor: number }[] };
export type CorrectionInput = { key: string; cardId: string; purchaseId: string; expectedVersion: number; replacement: PurchaseInput; recordedAt: string; reason: string };
export type CorrectionLink = { id: string; purchaseId: string; fromVersion: number; toVersion: number; reversalJournalId: string; replacementJournalId: string; reason: string; recordedAt: string };
export type ComponentRevision = { id: string; componentId: string; billingId: string; revision: number; purposeId: string | null; minor: number; purchaseDate: string };
export type AttributionState = { billings: Billing[]; payments: Payment[]; attributions: Attribution[]; credits: LinkedCredit[]; componentRevisions: ComponentRevision[]; attributionRevisions: AttributionRevision[] };
export type CreditRevision = { id: string; creditId: string; purchaseVersion: number; reversalJournalId: string; replacementJournalId: string; recordedAt: string; credit: LinkedCredit };
export type AttributionRevision = { paymentId: string; revision: number; unappliedMinor: number };

/** Supported pre-opening principal; evidence only, never a reconstructed purchase. */
export type OpeningObligation = { id: string; cardId: string; currency: Currency; openingJournalId: string; evidenceIds: string[]; originalPrincipalMinor: number; alreadyBilledMinor: number; remainingMinor: number; purchaseDate: string; lastBilledInstallment: number; installmentCount: number; allocations: { purposeId: string | null; minor: number }[] };
export type OpeningBillingInput = Omit<BillingInput, "purchaseId"> & { openingObligationId: string };
```

### Source identity inputs

Source: `web/src/lib/accounting/evidence.ts`.

```typescript
export type SourceRevisionInput = {
  key: string; cardId: string | null; kind: "statement" | "receipt";
  documentHash: string; objectPath: string; rawPayload: unknown;
  previousRevisionId: string | null; recordedAt: string;
  fiscalId: string | null; closingDate: string | null;
};
export type PurchaseIdentityInput = {
  cardId: string; currency: Currency; purchaseDate: string; voucher: string | null;
  installment: number | null; installmentCount: number | null;
  amountMinor: number; sourceLineId: string;
};
export type PurchaseIdentity = PurchaseIdentityInput & { purchaseId: string };
export type IdentityDecision = { status: "matched" | "new" | "review"; purchaseId: string | null; reason: string };
```

### Evidence and receipt entities

Source: `web/src/lib/accounting/evidence-port.ts`.

```typescript
export type SourceObject = DocumentRef & { byteLength: number };
export type SourceRevision = SourceRevisionInput & {
  id: string; payloadDigest: string; sourceKey: string; rawObject: DocumentRef | null; appRevision: string;
  admission: "accepted" | "rejected" | "pending";
};
export type SourceLine = { id: string; revisionId: string; occurrence: number; payload: Record<string, unknown>; legacyFingerprint: string | null };
export type ImportReview = { code: string; params: Record<string, string | number>; sourceLineIds: string[] };
export type ReviewEvent = ImportReview & { id: string; subjectId: string; priorDecisionId: string | null; state: "open" | "reviewed" | "dismissed"; recordedAt: string };
export type ImportResult = { sourceRevisionId: string; purchaseIds: string[]; postedJournalIds: string[]; reviews: ImportReview[]; duplicate: boolean };
export type SourceImportCommand = { key: string; digest: string; result: ImportResult };
export type StatementFacts = { revisionId: string; cardId: string; closingDate: string; period: unknown; terms: unknown; schedules: unknown[] };
export type ReceiptFacts = {
  revisionId: string; receiptId: number; chain: string; fiscalId: string | null; date: string | null; totalMinor: number | null;
  parsed: ParsedReceipt; report: VerificationReport; scale: number;
  originalRowsObject: DocumentRef; correctedRowsObject: DocumentRef | null; productReviewed: false;
};
export type ReceiptLinkDecision = {
  id: string; key: string; receiptRevisionId: string; purchaseId: string | null; cardId: string | null;
  paymentVerified: boolean; action: "link" | "unlink"; recordedAt: string; previousDecisionId: string | null;
  allocation: { accountId: string; purposeId: string; minor: number }[] | null;
  itemAllocations: {sourceLineId:string;accountId:string;purposeId:string;minor:number}[];
};
```

### Product merchant and review entities

Source: `web/src/lib/accounting/review.ts`.

```typescript
export type ProductSubject={kind:"product";id:string;name:string;category:ProductCategory;unit:"un"|"kg";reviewed:boolean;redirectId:string|null};
export type CodeSubject={kind:"code";id:string;chain:string;sku:string;productId:string;ean?:string|null};
export type MatchSubject={kind:"match";id:string;receiptRevisionId:string;sourceLineId:string;productId:string;method:"code"|"rule"|"manual"|"auto";reviewed:boolean;unitCorrection?:{from:"kg";to:"un";reason:"packaged_mass"}};
export type MerchantSubject={kind:"merchant";id:string;normalizedName:string;redirectId:string|null;displayName?:string;position?:number};
export type MerchantPurchaseSubject={kind:"merchant_purchase";id:string;purchaseId:string;cardId:string;merchantId:string;sourceLineId:string};
export type RuleSubject={kind:"rule";id:string;match:string;accountId:string;purposeId:string;position:number;enabled:boolean};
export type ProductRuleSubject={kind:"product_rule";id:string;chain:string;match:string;productId:string;position:number};
export type ProposalSubject={kind:"proposal";id:string;merchantId:string;sanitizedMerchant:string;state:"pending"|"accepted"|"rejected";evidence?:{sent:string;confidence:"high"|"low";legacyCategory?:string;legacySubcategory?:string}};
export type AlertSubject={kind:"alert";id:string;state:"open"|"reviewed"|"dismissed";source?:{kind:string;message:string;expected:number|null;actual:number|null;legacyKey:string}};
export type RejectionSubject={kind:"rejection";id:string;merchantId:string};
export type ReviewSubject=ProductSubject|CodeSubject|MatchSubject|MerchantSubject|MerchantPurchaseSubject|RuleSubject|ProductRuleSubject|ProposalSubject|AlertSubject|RejectionSubject;
export type ReviewKind="historical_refund"|"source_classification"|"product_match"|"product_update"|"product_merge"|"move_code"|"merchant_merge"|"alert_state"|"proposal_accept"|"proposal_reject";
export type ReviewDecision={id:string;key:string;digest:string;subjectId:string;kind:ReviewKind;payload:Record<string,unknown>;priorDecisionId:string|null;recordedAt:string;affectedIds:string[]};
```

### Receipt extraction entities

Source: `web/src/lib/receipts/parse.ts`.

```typescript
export type DiscountLine = { label: string; tag: "M" | "A"; amountCents: number };
export type ParsedItem = {
  position: number;
  descPrinted: string;
  noPromo: boolean;
  sku: string | null;
  ean: string | null;
  qtyMilli: number;
  unit: "un" | "kg";
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  discounts: DiscountLine[];
};
export type ParsedHeader = {
  date: string | null; time: string | null;
  branchName: string | null; branchCode: string | null;
  fiscalNumber: string | null; register: string | null; terminal: string | null; trx: string | null;
  cuit: string | null; cae: string | null; caeDue: string | null;
  paymentMethod: string | null; paymentRef: string | null; paymentCents: number | null;
};
export type ParsedOffer = { label: string; amountCents: number | null };
export type ParsedFooter = {
  subtotalCents: number | null; discountsCents: number | null; totalCents: number | null;
  savingsCents: number | null; offers: ParsedOffer[];
};
export type ParsedReceipt = { header: ParsedHeader; items: ParsedItem[]; footer: ParsedFooter; notes: string[] };
```

### Receipt verification entities

Source: `web/src/lib/receipts/verify.ts`.

```typescript
export type Check = {
  name: "subtotal" | "discounts" | "total";
  computed: number;
  printed: number | null;
  ok: boolean;
};
export type OfferCheck = { label: string; printed: number | null; computed: number | null; ok: boolean };
export type VerificationReport = {
  ok: boolean;
  checks: Check[];
  offers: OfferCheck[];
  warnings: string[];
  errors: string[];
};
```

### Report and inspection entities

Source: `web/src/lib/accounting/read-model.ts`.

```typescript
export type ReportFact = {
  id: string; purchaseId: string | null; cardId: string; origin?: "ledger" | "issuer_observation" | "historical_acquisition"; journalId?: string; sourceSection?: string;
  kind: "purchase" | "billing" | "payment" | "credit" | "cost" | "opening";
  description?: string | null; receiptIds?: number[]; installmentNumber?: number | null; installmentCount?: number | null; financed?: boolean; purchaseDate?: string;
  merchant: string | null; accountId: string | null; purposeId: string | null;
  currency: "ARS" | "USD"; minor: number; effectiveDate: string; cycleMonth: string | null;
  sourceLineId: string | null; statementId: string | null; coverage: "complete" | "opening" | "uncertain";
};
export type ReportScope = { basis: "purchase" | "billed"; value: "nominal" | "real" | "usd"; tax: "excl" | "incl"; granularity: "month" | "quarter" | "year" | "all"; period: string | null };
export type SpendRow = { period: string; accountId: string; purposeId: string | null; amount: number };
export type StatementFact = { id: string; cardId: string; sourceRevisionId: string; current: boolean; closingDate: string; previousClosingDate: string | null; dueDate: string | null; cycleMonth: string; balanceArsMinor: number | null; balanceUsdMinor: number | null; previousBalanceArsMinor: number | null; minimumPaymentArsMinor: number | null; purchaseLimitArsMinor: number | null; tnaPct: number | null; temPct: number | null };
export type ScheduleFact = { cardId: string; revisionId: string; current: boolean; month: string; amount: number };
export type ReceiptAllocationFact = { receiptId: number; itemId: string; accountId: string | null; purposeId: string | null; netMinor: number; reviewed: boolean };
export type PurposeMeasureInput = { cardId: string; currency: Currency; from: string; to: string };
export type PurposeMeasure = { purposeId: string | null; expenseMinor: number; debtMinor: number; repaymentMinor: number };
export type PurposeSnapshot = { journals: Journal[]; accounts: Account[]; purchases: PurchaseVersion[]; state: AttributionState };
export type OpeningCoverage = { mode: "historical" | "opening"; cutoffDate: string; unresolvedCount: number; reconciliation: { cardId: string; currency: Currency; issuerDate: string; issuerBilledMinor: number | null; supportedUnbilledMinor?: number; futureScheduleMinor?: number; futureAggregateMinor?: number; unsupportedFutureRemainderMinor?: number; completeFuturePrincipalKnown?: boolean }[] };
export type AccountingInspection = { openingCoverage?: OpeningCoverage; historicalAssociations?: import("./historical-links").HistoricalReceiptAssociation[]; groups?: import("./catalog").AccountGroup[]; merchants?: import("./review").MerchantSubject[]; merchantPurchases?: import("./review").MerchantPurchaseSubject[]; journals: Journal[]; accounts: Account[]; cards: { id: string; displayName: string }[]; sources?: import("./evidence-port").SourceRevision[]; sourceLines?: import("./evidence-port").SourceLine[]; reviews?: import("./evidence-port").ReviewEvent[]; alertStates?: { id: string; state: "open" | "reviewed" | "dismissed"; source?: {kind:string;message:string;expected?:unknown;actual?:unknown;legacyKey?:string} }[] };
```

### Receipt analytics entities

Source: `web/src/lib/receipts/facts.ts`.

```typescript
export type ReceiptFact = {
  id: number; date: string; time: string | null;
  subtotalCents: number; discountsCents: number; totalCents: number;
};
export type RawReceiptItemFact = {
  sourceLineId: string; receiptId: number; qtyMilli: number; grossCents: number; discountCents: number; hasM: boolean; hasA: boolean;
};
export type ItemFact = {
  receiptId: number; productId: number; productName: string; category: ProductCategory; unit: "un" | "kg";
  qtyMilli: number; grossCents: number; discountCents: number; hasM: boolean; hasA: boolean;
};
```

### Issuer statement integrity projection

This declaration is deliberately narrower than the Python extraction output. Preserve unknown source fields. The companion build specification and complete synthetic parser JSON define the extraction envelope, including issuer metadata and `voucher`, `raw_line`, and `block_cardholder`; do not strip those properties to satisfy this projection.

Source: `web/src/lib/integrity.ts`.

```typescript
export type StatementJson = {
  file: string;
  brand: string;
  period: { closing_date: string; due_date?: string; previous_closing_date?: string | null };
  balances?: {
    previous_ars?: number | null;
    current_ars?: number | null; current_usd?: number | null; minimum_payment_ars?: number | null;
  };
  limits?: { purchase?: number | null };
  rates?: { annual_nominal_ars?: number | null; monthly_effective_ars?: number | null };
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
```

### Historical receipt association entities

Source: `web/src/lib/accounting/historical-links.ts`.

```typescript
export type HistoricalReceiptAssociation={id:string;key:string;digest:string;receiptRevisionId:string;sourceLineId:string;cardId:string;currency:"ARS";receiptMinor:number;statementMinor:number;installmentCount:number|null;action:"link"|"unlink";previousDecisionId:string|null;method:"auto"|"manual";recordedAt:string;legacyFingerprint:string|null;provenance:Record<string,unknown>};
export interface HistoricalLinksTx {
 historicalAssociations(receiptRevisionId?:string):Promise<HistoricalReceiptAssociation[]>;
 historicalAssociationCommand(key:string):Promise<HistoricalReceiptAssociation|null>;
 appendHistoricalAssociation(row:HistoricalReceiptAssociation):Promise<void>;
}
export type HistoricalAssociationInput={key:string;receiptRevisionId:string;sourceLineId:string|null;action:"link"|"unlink";expectedPreviousDecisionId:string|null;method:"auto"|"manual";recordedAt:string;legacyFingerprint?:string|null;provenance?:Record<string,unknown>};
```

### Catalog group schema

Source: `web/src/lib/accounting/catalog.ts`.

```typescript
export type AccountGroup = { id: string; customName: string | null; labelKey: string | null; accountIds: string[]; additive: boolean };
```

## Exact legacy SQLite table definitions

Source: `web/src/lib/db.ts`. This is the current initial table/index DDL, not PostgreSQL schema. The migration function additionally widens older databases, adds the fingerprint index/backfill, and seeds empty catalogs where configured.

```sql
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
      installment_count INTEGER,
      fingerprint TEXT
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
    -- Merchant rules, formerly data/merchant-categories.json. Correcting a category is a data
    -- change now, not a source change: that file is tracked by git, this database is not.
    -- The position column is explicit and load-bearing: categorize() is first-match-wins, so
    -- MOVISTAR AR must be tried before MOVISTAR or a concert becomes a phone bill. Never rowid.
    CREATE TABLE IF NOT EXISTS category_rules (
      position INTEGER NOT NULL PRIMARY KEY,
      match TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      subcategory TEXT
    );
    -- LLM classifications waiting for a human decision on /review. The position column keeps
    -- the review table in a stable order between renders.
    CREATE TABLE IF NOT EXISTS category_proposals (
      position INTEGER NOT NULL PRIMARY KEY,
      merchant TEXT NOT NULL UNIQUE,
      sent TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('high','low'))
    );
    -- Merchants a human declined to categorize, so the next propose run stops asking about them.
    CREATE TABLE IF NOT EXISTS rejected_merchants (
      position INTEGER NOT NULL PRIMARY KEY,
      merchant TEXT NOT NULL UNIQUE
    );
    -- Merchant aliases, formerly data/merchant-aliases.json. Prefix match, first match wins, so
    -- position matters here for the same reason it does on the rules.
    CREATE TABLE IF NOT EXISTS merchant_aliases (
      position INTEGER NOT NULL PRIMARY KEY,
      match TEXT NOT NULL UNIQUE,
      alias TEXT NOT NULL
    );
    -- Supermarket receipts (spec: docs/superpowers/specs/2026-09-04-supermarket-receipts.md).
    -- Money is integer cents and quantities integer thousandths: the ingest gate reconciles a
    -- receipt to the cent, and a REAL that lands 0.004 off would fail one that is right on paper.
    -- fiscal_number (NRO.T.) and the file hash are the two identities; the file NAME is nothing.
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY,
      chain TEXT NOT NULL,
      branch_code TEXT,
      branch_name TEXT,
      date TEXT NOT NULL,
      time TEXT,
      fiscal_number TEXT NOT NULL UNIQUE,
      file_sha256 TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      register TEXT,
      terminal TEXT,
      trx TEXT,
      cae TEXT,
      cae_due TEXT,
      payment_method TEXT,
      payment_ref TEXT,
      subtotal_cents INTEGER NOT NULL,
      discounts_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      header_json TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      transcript_source TEXT NOT NULL CHECK (transcript_source IN ('ocr','corrected')),
      ocr_scale REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY,
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      desc_printed TEXT NOT NULL,
      no_promo INTEGER NOT NULL DEFAULT 0,
      sku TEXT,
      ean TEXT,
      qty_milli INTEGER NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('un','kg')),
      unit_price_cents INTEGER,
      line_total_cents INTEGER NOT NULL,
      UNIQUE (receipt_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
    CREATE TABLE IF NOT EXISTS receipt_discounts (
      id INTEGER PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      tag TEXT NOT NULL CHECK (tag IN ('M','A')),
      amount_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipt_transcripts (
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ocr','corrected')),
      text TEXT NOT NULL,
      PRIMARY KEY (receipt_id, kind)
    );
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
    -- One receipt ↔ one charge. The charge side is a fingerprint, not transactions.id: rows are
    -- rebuilt on every re-ingest and their ids change, the fingerprint does not (see
    -- fingerprint.ts). No foreign key for the same reason alert_reviews has none.
    CREATE TABLE IF NOT EXISTS receipt_charge_links (
      receipt_id INTEGER NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL CHECK (method IN ('auto','manual')),
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(fingerprint);
```

## Follow up task

Use the context above to address the specific task supplied next. If no task is supplied, acknowledge the project model briefly and wait for the requested work.
