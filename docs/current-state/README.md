# Tarjetas current features and preservation baseline

Tarjetas currently analyzes credit-card statements and Coto supermarket receipts. It connects purchase detail to billed charges and provides spending, price, timing, and commitment reports. The next accounting system should retain these capabilities even if every implementation component changes.

Baseline: source revision `c1f353c310b8b5244b3a2f834a98507d135213d7`, reviewed on 2026-10-25. This describes the checked-out application, not a verified deployment or an inventory of private financial records.

## Read the baseline

| Material | Purpose |
| --- | --- |
| [Feature inventory](features.md) | All 28 navigation destinations, receipt detail, user actions, and cross-cutting capabilities |
| [Behavior and calculations](behavior.md) | What the figures mean, including timing, currency, tax, forecast, and receipt rules |
| [Data and workflows](data-and-workflows.md) | Sources, stored facts, decisions, relationships, imports, corrections, and recovery |
| [Preservation scenarios](preservation.md) | Observable examples to validate a replacement implementation |
| [Accounting questions](accounting-questions.md) | Unresolved decisions and the interview frontier |
| [Accounting migration requirements](../accounting/requirements.md) | Consolidated accepted scope, rules, workflow and implementation prerequisites |
| [Incremental accounting implementation plan](../superpowers/plans/2026-10-25-accounting-architecture.md) | Four linked plans, 16 reviewable task groups, complete feature coverage, verified preflight backup and staged cutover gates; planning only |
| [Installment accounting policy](../accounting/installments.md) | Accepted Q8 purchase recognition, billed/unbilled debt, repayments and incomplete-history treatment |
| [Proposed chart and account groups](../proposals/personal-chart-of-accounts.md) | New account candidates grounded in actual expense lines, separate from the current category systems |
| [Personal finance grouping research](../research/2026-10-25-personal-finance-grouping.md) | Public household-purpose classifications and their relationship to accounting types |
| [Domain glossary](../../CONTEXT.md) | Current terms, independent of implementation |

Start with the inventory, then use the scenarios to define acceptance for a rewrite. Source links identify where current behavior can be checked; they do not prescribe retaining those files, tables, libraries, routes, or chart designs.

## What is settled

- Preserve features and the information needed to support them. Code reuse is optional.
- A double-entry accounting system is the intended direction for connecting financial information.
- Better code, including a rewrite, is a secondary goal.
- First migrate the existing card features into the accounting architecture; add bank accounts and transfers afterward.
- The target initially covers one person's finances with explicit distinct accounts/cards. Hosting and PostgreSQL are required.
- Retain source evidence and decisions; explain explicitly agreed corrections rather than requiring exact reproduction of defects. Test historical reconstruction in isolation before choosing the cutover, and use explicit opening balances for missing prehistory.
- Preserve native ARS/USD amounts and actual conversion evidence where available; keep IPC/MEP reporting distinct from accounting valuation.
- Initial card accounting balances native ARS and USD independently. Statement payments use an unresolved payment-source clearing account until bank integration can reconcile their origin.
- A new chart of accounts is required: the user dislikes both existing category systems and requests expense-informed alternatives. A separate group type must be able to contain several accounts across accounting types; the proposed taxonomy and report behavior await review. Preserve conflicting receipt/issuer evidence for explained reconciliation, version source corrections, and use reversal/replacement for posted entries.
- Q16 accepts intermediate account detail, including seven grocery subaccounts; Q18 accepts a primary purpose for additive summaries plus overlapping custom groups. Q17/Q21 put purchases made while abroad in Travel; online subscriptions retain ordinary accounts. The vehicle-plan line is car payments and Sancor is car insurance, both under Transportation, without assuming the car-payment principal/fee split.
- Linked refunds/promotions follow the original purchase account as separate events. Reviewed items of a verified linked domestic receipt allocate the same purchase across accounts without duplicate spending. Domestic supermarket purchases without sufficient item detail remain Unallocated, with amounts and evidence visible.
- Once the applicable accounting rules are settled, validated known-nature imports post automatically; ambiguous nature, duplicate identity or conflicting totals stays in review. Account corrections default to the selected purchase, with explicit future-rule and matching-history options and preserved audit history.
- Historical analytics use the latest corrected classification. Original evidence, earlier assignments and posted-entry revisions remain inspectable; a separate full “as originally reported” chart mode is outside the agreed scope.
- Q28–Q31 accept ordinary durable purchases as expenses by default with explicit supported asset/prepayment exceptions; corrections in the original effective period with actual correction time retained and no initial period locks; evidence-supported receipt-first recognition; and issuer repayment allocations where available, otherwise a disclosed oldest-billed-first analytical convention for billed debt. Unknown opening debt and unapplied credits remain visible.
- Multilingual support extends to every new accounting feature: English default, Spanish choice, translated built-in accounts/groups and interface messages, stable language-independent identities, preserved source text and unchanged financial semantics. Q32 accepts one shared custom account/group name displayed verbatim in both languages; a custom rename overrides its built-in display name in both.
- Hosted receipt processing must retain exact-cent verification and manual correction. The OCR engine is undecided; external document processing is not authorized. No application login is required for now; network exposure remains a deployment decision.
- The eventual trace is purchase/receipt → card liability → actual payment account, delivered in the agreed release sequence. Q8 accepts [recognizing the purchase and full known principal once](../accounting/installments.md), with billed/unbilled debt and separate repayments. Detailed financial components, settlement policies, and the final cutover remain open in [the interview](accounting-questions.md).

## Current boundaries

The current schema and route tree implement statement and receipt analysis, without a general journal, chart of accounts, explicit bank/wallet accounts, payment-to-account reconciliation, or balance sheet. “Cash” and “accrual” are report modes with application-specific meanings, explained in [behavior](behavior.md). Statement balances, purchase totals, receipt totals, and forecasts answer different questions and must not simply be added together.

The implementation uses a local SQLite database and document directories, a Next.js interface, Python statement parsing, and local Apple Vision receipt OCR. Optional merchant-name classification calls Anthropic. External IPC and MEP series are updated through scripts. These are present implementation facts, not constraints imposed on a replacement.

## Relationship to earlier documents

[The original analysis](../analysis.md), [receipt specification](../superpowers/specs/2026-09-04-supermarket-receipts.md), and dated plans remain historical design material. Where they differ from current behavior, use this baseline together with the linked owning source:

| Earlier description | Current implementation |
| --- | --- |
| Merchant mappings and aliases in JSON files | Ordered rules, aliases, proposals, and rejections persist in SQLite; legacy JSON can seed empty tables |
| MEP joined at ingestion | Most report conversion happens on read using cached monthly tables |
| Forecast over a 12-month horizon | `/future` currently requests the default six months |
| Full purchase recognized at purchase date in every accrual report | Earliest observed installment represents remaining principal; aggregate periods follow cycle month, while calendar uses purchase date |
| Monthly/annual recurring cadence | Current detector evaluates month coverage and price stability; it has no separate annual-cadence model |
| Original sample of two cards and fixed record counts | Code has Visa, Mastercard, and Mercado Pago parsing; data coverage and volumes depend on the installation |
| English-only interface | English is default, with an explicit Spanish switch |

## Evidence and verification scope

The initial inventory was traced through navigation, route pages and actions, schema, import pipelines, report functions, and relevant test definitions, without inspecting private financial records. The user subsequently authorized a read-only expense-line review for the [account proposal](../proposals/personal-chart-of-accounts.md); that additional evidence is kept separate from the source-code baseline. No source PDFs or deployment were inspected for the account proposal, and no private records were sent to online research or classification services. No application tests, build, live OCR, or browser acceptance checks were run for these documentation changes. Existing tests are referenced as reusable evidence and future checks, rather than reported as passing.

Documentation checks passed for local links, all 29 page routes (28 navigation destinations plus receipt detail), all 33 feature IDs mapped to preservation scenarios, balanced code fences, whitespace, and diff scope. A future implementation needs both calculation tests and user-visible workflow checks; see [preservation scenarios](preservation.md).
