# Current feature inventory

Each row describes a capability to preserve, rather than code or a screen layout to retain. Route links point to the current page implementation. Shared numerical semantics are in [behavior](behavior.md); import and editing workflows are in [data and workflows](data-and-workflows.md).

## Overview and investigation

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F01 | [Overview `/`](../../web/src/app/page.tsx) | See latest cycle spending and previous-cycle change, next forecast range, top three categories, open-alert count and preview, remaining installment commitments, and a 12-point spending sparkline. Tiles lead to detailed reports. |
| F02 | [Alerts `/anomalies`](../../web/src/app/anomalies/page.tsx) | Review statement discrepancies and computed duplicate, price-jump, and new-merchant flags. See flagged periods against spending; mark reviewed, dismiss, or reopen; follow a merchant into spending detail. Review states affect the overview count. |

## Spending analysis

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F03 | [Trends `/trends`](../../web/src/app/trends/page.tsx) | Compare category spending over month, quarter, year, or all-history buckets in a stacked area chart. |
| F04 | [Categories `/categories`](../../web/src/app/categories/page.tsx) | Drill from category to subcategory to merchant and statement lines; retain period and valuation choices; navigate breadcrumbs; see printed descriptions alongside normalized merchants and linked receipts. Correct categorization or merge merchant names from a line. Current detail table displays up to 200 rows. |
| F05 | [Merchants `/merchants`](../../web/src/app/merchants/page.tsx) | Rank merchants by net positive spending, see concentration and cumulative shares, top-five/top-twenty shares, active months and charge counts. View new-versus-returning merchant spend over time, drill to a merchant, and merge names. Ranking defaults to all history; its period filter does not scope the separate novelty time series. |
| F06 | [Movers `/movers`](../../web/src/app/movers/page.tsx) | Explain the change between the latest two month/quarter/year buckets by category contribution; distinguish a new category from a meaningful percentage change. |
| F07 | [Compare `/compare`](../../web/src/app/compare/page.tsx) | Compare successive period totals and percentage deltas; identify incomplete card coverage. A zero previous total produces an undefined delta rather than infinity. |
| F08 | [Sankey `/sankey`](../../web/src/app/sankey/page.tsx) | Follow positive net spending from card brand through category to merchants in a selected period; group the long merchant tail per category. |

## Purchase timing and recurring behavior

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F09 | [Calendar `/calendar`](../../web/src/app/calendar/page.tsx) | Explore spending intensity by original purchase day, inspect category totals and charges for a selected day, and reach linked receipts. Installment decisions collapse through the purchase commitment view. |
| F10 | [Habits `/habits`](../../web/src/app/habits/page.tsx) | Compare weekday spending/category mix and purchase counts, plus period purchase count, average ticket and median ticket. Distinguish more purchases from more expensive purchases. |
| F11 | [Pace `/pace`](../../web/src/app/pace/page.tsx) | Compare cumulative spending within statement cycle windows with the median of prior cycles, using each card's own closing window. |
| F12 | [Recurring `/recurring`](../../web/src/app/recurring/page.tsx) | Separate active likely subscriptions, regularly visited variable merchants, and lapsed recurring merchants. See current billing currency, currency migration, last amount, comparable change, observed months, and next expected month or last-seen month. See ARS/USD totals and combined MEP equivalent. |

## Valuation and card economics

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F13 | [Currency `/currency`](../../web/src/app/currency/page.tsx) | Compare ARS-billed and USD-billed spending in a common selected display basis. Unlike ordinary peso spending reports, this lens also converts USD-billed rows into pesos. |
| F14 | [Inflation `/inflation`](../../web/src/app/inflation/page.tsx) | Compare the matched recurring-merchant price index with official IPC and inspect which merchants make up the basket. |
| F15 | [Taxes `/taxes`](../../web/src/app/taxes/page.tsx) | Break down RG 5617, IVA, IIBB, stamp duty, interest, and other issuer charges over time; compare overhead with purchases using a common nominal-peso denominator. |
| F16 | [Credits `/credits`](../../web/src/app/credits/page.tsx) | Inspect money back from promotions, merchant reversals/refunds, and selected tax recovery lines; see periods, proportion of positive ARS purchases, and largest credits. Own card repayments are excluded. |
| F17 | [Float `/float`](../../web/src/app/float/page.tsx) | Estimate purchase-to-due delay and purchasing-power gain for one-off and installment purchases; compare the modeled benefit with recorded interest costs. |

## Future commitments and issuer terms

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F18 | [Future `/future`](../../web/src/app/future/page.tsx) | Explore six future months as separate certain installment, expected recurring, and estimated variable-spend layers, including a low/high range and the inflation assumption. |
| F19 | [Installments `/installments`](../../web/src/app/installments/page.tsx) | See historical billed installment versus one-off burden, plan counts and share, current open plans by merchant/card, and remaining months and principal; follow the link to Future for the forward commitment schedule. |
| F20 | [Bank `/bank`](../../web/src/app/bank/page.tsx) | Inspect monthly purchase limits and financing rates by card, combined balances and limits, utilization, minimum-payment share, worst available TEM, and its comparison with inflation and real financing cost. See real erosion of the largest card's limit over up to 12 observed intervals. Missing card coverage creates a gap in total limits. |

## Supermarket purchase detail

| ID | Current destination | User capability and visible result |
| --- | --- | --- |
| F21 | [Supermarket `/super`](../../web/src/app/super/page.tsx) | See last shopping total/change, average shopping total, indicative monthly spend, accumulated savings, receipt-by-receipt paid/discount bars, gross/effective product price indices, and savings by promotion family. |
| F22 | [Products `/super/products`](../../web/src/app/super/products/page.tsx) | Compare repeated products' last gross/net unit-price changes and price trends; rank the top 15 products by spend and see quantities, purchase frequency groups, and products entering/leaving the latest basket. |
| F23 | [Product categories `/super/categories`](../../web/src/app/super/categories/page.tsx) | See net category spend for each receipt, totals, shares, and discounts in a category-by-shopping-period matrix. Product categories are distinct from card spending categories. |
| F24 | [Receipts `/receipts`](../../web/src/app/receipts/page.tsx) | Upload Coto receipt PDFs, see success/rejection and verification details, correct a rejected OCR transcript and retry, and browse accepted receipts with their provenance. |
| F25 | [Receipt charge matching `/super/charges`](../../web/src/app/super/charges/page.tsx) | Compare receipts and supermarket card charges, identify missing receipts and unlinked/ambiguous receipts, inspect automatic/manual links, and manually link or unlink candidates. |
| F26 | [Product review `/super/review`](../../web/src/app/super/review/page.tsx) | Review automatically created product identities with printed descriptions, codes and spending evidence. Name/categorize products, set unit, merge identities, move an article code, and rebuild product matches. |
| F29 | [Receipt detail `/receipts/[id]`](../../web/src/app/receipts/[id]/page.tsx) | Inspect fiscal/payment metadata, item quantities and printed identifiers, prices, line discounts and net amounts, verification warnings, accepted transcript, and linked card charge or candidate links. This is additional to the 28 static navigation links. |

## Data management and cross-cutting capabilities

| ID | Capability | User-visible contract |
| --- | --- | --- |
| F27 | [Statements `/upload`](../../web/src/app/upload/page.tsx) | Upload issuer statement PDFs and see ingestion summaries, replacements, integrity alerts, stale IPC warnings, setup errors, and the statement history. Supported parsers cover BBVA Visa/Mastercard layouts and Mercado Pago's credit-card layout. |
| F28 | [Merchant review `/review`](../../web/src/app/review/page.tsx) | Review uncategorized merchants, optionally request AI proposals, inspect evidence and substring-rule impact, edit and accept classifications, or reject future suggestions for a merchant. Human acceptance is required for proposals. |
| F30 | [Shared controls](../../web/src/lib/chrome.ts) | Use applicable billed/purchase-commitment, real/nominal/USD, tax, and period controls. Query choices follow navigation; changing granularity clears an incompatible selected period. Each page exposes only applicable controls. |
| F31 | [Language](../../web/src/components/LangToggle.tsx), [theme](../../web/src/components/chart.tsx), [navigation](../../web/src/components/Nav.tsx) | Choose English or Spanish (English default, remembered in a cookie); use light/dark appearance following the OS; navigate a grouped desktop sidebar or mobile menu; scroll wide tables/charts. Raw merchant/product/source descriptions remain data. |
| F32 | [Backup and restore](../../BACKUP.md) | Back up the database, documents, pending receipt corrections, and reference files; verify an archive; restore locally or to compatible persistent storage with receipt path relocation and retained previous data. This capability is CLI-based. |
| F33 | [Reference-data updates](../../web/scripts/fetch-ipc.ts), [MEP updates](../../web/scripts/fetch-mep.ts), [JSON ingestion](../../web/scripts/ingest.ts) | Refresh valuation reference series and rebuild imported statement rows from extracted JSON using current naming/category decisions. These are operator scripts rather than UI controls. |

## User journeys spanning features

1. **Understand spending:** upload a statement → review unknown merchants → inspect overview/trends → drill category/merchant → correct a rule or merge names → inspect the updated history.
2. **Investigate a charge:** open an alert → inspect merchant/printed line → inspect linked receipt if present → mark reviewed/dismiss or reopen. Review changes status, never the issuer amount.
3. **Understand a shopping trip:** upload receipt → reconcile or correct transcript → review new products → inspect item prices/savings → connect the receipt to its card charge → compare product history.
4. **Understand commitments:** inspect billed installment burden → inspect active plans and newest issuer schedules → inspect forecast layers → compare inflation, float, and issuer financing terms.
5. **Protect and relocate data:** pause writes → create and verify backup → stop destination application → restore → check statements, receipt details, pending corrections, review decisions, and links.
