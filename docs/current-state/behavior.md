# Current report behavior and calculations

These rules explain today's reported figures. They are a comparison baseline for a rewrite, not an approved accounting policy. Proposed changes to their meaning require explicit decisions, especially where a current approximation is useful but incomplete.

## Reporting time and shared modes

Source: [statement ingestion](../../web/src/lib/ingest.ts) (`cycleMonth`), [scope](../../web/src/lib/scope.ts), [page controls](../../web/src/lib/chrome.ts), [report calculations](../../web/src/lib/queries.ts) (`baseRows`, `amountCtx`, `effectiveAmount`).

- The **cycle month** is the month containing the midpoint between the previous and current statement closing dates. Without a previous closing date, the start is approximated as closing minus 30 days.
- Most spending charts group by cycle month, then optionally quarter, year, or all history. They do not regroup purchases by their calendar date.
- Base spending consists of nonzero `purchases` rows, including negative reversals. Payments and issuer tax/charge rows do not directly join this spending set.
- If an ARS amount is present, that is the primary amount; otherwise a USD amount can contribute. A row is not treated as two purchases simply because both columns exist.
- Defaults are **purchase commitment (`accrual`)**, **real pesos (`real`)**, **tax excluded (`excl`)**, and **monthly** grouping. Period-filtered categories/Sankey default to latest; merchant ranking defaults to all history.

| Mode | Current rule | Example or limitation |
| --- | --- | --- |
| `cash` | Use each billed purchase row in its statement cycle | Six installments of ARS 100 contribute 100 in each observed billed cycle; payment of the card bill is a separate matter |
| `accrual` | Group a series by merchant + installment count + printed purchase date; use its earliest observed installment `k`, valued as billed amount × `(count − k + 1)`; skip later installments | With installment 1 of 6 available, 100 becomes 600 once. If history starts at 3 of 6, it becomes 400 once; paid installments are not invented |
| `nominal` | Use ARS as printed, without inflation adjustment | Ordinary peso totals omit USD-only purchases |
| `real` | ARS × IPC(latest available IPC month) / IPC(row cycle month) | Every included cycle is restated to one common purchasing-power basis; ordinary totals still omit USD-only purchases |
| `usd` | ARS / monthly MEP; USD-only purchases use their printed USD amount | Native USD refunds net against native USD purchases |
| Tax excluded | Use purchase amounts without allocated issuer charges | Receipt item discounts remain part of receipt net prices; this toggle does not remove receipt taxes |
| Tax included | Multiply purchase values by their statement's proportional tax multiplier | An analytical allocation; it does not identify a tax owed by a specific merchant purchase |

The current installment series key in shared spending reports lacks an explicit account/card identifier. Same-merchant, same-date, same-count purchases can collide. Preserve the ability to distinguish purchase decisions; whether to reproduce or correct such collisions is an open parity decision, not a requirement to copy this key.

### Valuation references and fallback

[CPI](../../web/src/lib/cpi.ts) uses exact month or nearest earlier available month; a request before all available history or an empty table raises a setup/data error. [MEP](../../web/src/lib/mep.ts) uses the same lookup rule. The [MEP fetcher](../../web/scripts/fetch-mep.ts) averages daily sell quotes by calendar month; the [IPC fetcher](../../web/scripts/fetch-ipc.ts) writes the configured national index series. Updates are explicit scripts, not automatic imports triggered by upload. Values are cached within the running server process.

Report conversions occur on read. Refreshing the reference files and reloading the process can change historical real/USD reports. The current system does not freeze an accounting exchange rate with each purchase. A future ledger must decide independently how actual conversion, settlement, and exchange gains/losses work.

### Tax allocation and dedicated tax report

`taxMultipliers` computes, per statement:

`base = net ARS purchases + net USD-only purchases × MEP(cycle month)`

`multiplier = 1 + included ARS taxes_and_charges / base` when `base > 0`; otherwise no multiplier.

Rows whose descriptions start `DEVOLUCION` are excluded from issuer taxes/charges for this calculation. The multiplier applies to positive and negative purchases; it is not an additional persisted purchase. Foreign purchases participate in the denominator, even when an ordinary peso spending report does not show their principal.

`taxBurden` groups actual ARS issuer lines into RG 5617, IVA, IIBB, stamp duty, interest, and other, excluding `DEVOLUCION`. Display amounts convert month by month. Overhead percentage divides nominal taxes by nominal ARS purchases plus MEP-valued USD purchases across the whole grouped period, including its tax-free months. A nonpositive denominator gives an undefined rate.

## Which controls apply

Source: [route controls](../../web/src/lib/chrome.ts) and the linked [feature pages](features.md).

- Ordinary spending reports offer spend, value, and tax controls where applicable.
- Calendar, habits, and pace force purchase commitment timing. Habits' granularity applies to the ticket chart, not its weekday chart.
- Historical installment burden forces billed timing. Open-plan estimates convert the monthly installment and remaining principal without the shared tax multiplier.
- Taxes, credits, and bank terms offer value conversion without spend/tax choices. Bank terms remain monthly point-in-time series.
- Float is always a real-peso estimate. Recurring and personal inflation use their own native-currency/index semantics.
- Supermarket analytics offer value conversion only; receipt list/detail and charge reconciliation remain printed nominal ARS.
- Alert timeline follows display modes; the review table's amounts remain nominal ARS. Changing graph modes does not redefine detection.

## Spending, concentration, and timing

Source: [queries](../../web/src/lib/queries.ts).

| Calculation | Current behavior |
| --- | --- |
| `spendByCategory`, `periodTotals`, `periodComparison` | Sum effective signed purchase amounts. Comparison follows successive available buckets; a missing calendar bucket is not synthesized as a zero-spend period. A zero previous amount has no percentage delta. |
| `categoryDrill` | Apply category/subcategory/merchant/period filters; show contributing converted rows and native USD evidence. Some USD-only detail can remain visible without contributing to a peso total. Linked receipts are resolved through charge identity. |
| `merchantConcentration` | Net by merchant; remove merchants with total ≤ 0; use remaining positives for shares and cumulative shares; category is the dominant category by value. These totals can differ from a signed all-merchant total. |
| `merchantNovelty` | A merchant is new in its first observed cycle month. Quarter/year grouping regroups that monthly classification. The first observed history is necessarily all new. |
| `categoryMovers` | Compare last two available buckets; union categories across them; sort by signed contribution to the change. A missing/zero prior category has undefined percentage change. |
| `sankeyFlows` | Net by brand/category/merchant before dropping nonpositive flows; derive both edges from the same survivors. Show up to eight merchants per category plus an “other” tail. Positive flows conserve value through each category. |
| `dailySpend`, `weekdayProfile` | Collapse installment commitments and use original purchase dates. Weekday counts include only positive valued purchases; reversals affect amounts without creating visits. Calendar can retain USD-only detail outside USD mode. |
| `ticketTrend` | Positive purchase-commitment values only; refunds do not create tickets or cancel visits. Mean = positive total / count; median averages the two middle values for even sample sizes. Buckets follow cycle month. |
| `cyclePace` | Include dates within `(previous closing, current closing]`; omit rows without a known previous closing window. Compute each row's day offset in its own statement window, then combine cards by cycle month. Typical pace is the per-day median of prior cycles, carrying a completed short cycle's total through later days. |
| `currencySplit` | Convert native USD rows to ARS using their own cycle month's MEP in peso views; use USD directly in USD view. ARS uses shared effective-amount semantics. The current USD branch applies tax allocation but bypasses the installment collapse/multiplier, an asymmetry to resolve before a rewrite. |

## Recurring charges and personal inflation

Sources: [recurring detector](../../web/src/lib/recurring.ts), [personal index](../../web/src/lib/inflation.ts), `recurringTable` and `personalInflation` in [queries](../../web/src/lib/queries.ts).

1. Exclude installment rows; group remaining purchase movements by merchant and cycle month. Net same-currency refunds; a nonpositive net month is not an occurrence.
2. Require at least **four positive billed months** and **60% density** between the first and last positive months.
3. A merchant is **lapsed after at least two cycle months since its last occurrence**, measured against the newest purchase month in the input. Recency is relative to imported data, not today's wall clock.
4. Classify price confidence in the current billing currency. “Pegged” requires at least **25%** of consecutive observations to repeat the nominal price within **1%**. Otherwise “indexed” requires CPI-adjusted median absolute deviation / median ≤ **8%**. Without adequate CPI only nominal price stability can qualify. USD is evaluated without peso deflation.
5. Keep low-confidence regular merchants visible as variable spending. Track ARS→USD billing migration under the same merchant; percentage change across a currency switch is undefined. If both currencies occur in one month, the current detector selects the ARS cell rather than summing incompatible units.

Personal inflation uses detected merchants with ARS history, restricted to months with exactly one purchase row for that merchant and a positive ARS amount. It links successive observed basket months using only merchants present in both: `new index = old index × current matched total / previous matched total`. Both personal and official indices start at 100; without a usable overlap the personal index stays flat. It is an observed recurring-price lens, not a general cost-of-living measure.

## Alerts and review state

Sources: [integrity checks](../../web/src/lib/integrity.ts), [anomaly detector](../../web/src/lib/anomalies.ts), `reviewableAlerts`, `setAlertReview`, `staleReviews` in [queries](../../web/src/lib/queries.ts).

- Ingest-time integrity alerts compare selected ARS purchase-block totals and current balance fields with declared values, tolerating differences up to **ARS 1**. They are stored. Python PDF parsers also perform their own stricter checks, generally **ARS/USD 0.05**, and reject unsupported or inconsistent input. These gates are distinct from receipt verification.
- Duplicate candidates are non-installment ARS purchases ≥ **10,000**, at the same merchant and amount, on the same statement, within **two days**. A matching negative reversal on that statement marks the alert resolved by default.
- Amount-jump flags compare ARS recurring merchants' consecutive positive observed months with exactly one row in each. The increase must exceed **25% in real terms**.
- New-merchant flags apply only to the latest observed purchase cycle, once per first-seen merchant with net ARS spend ≥ **10,000**.
- Anomalies are recomputed from history and IPC. Reviews persist as open/reviewed/dismissed by a derived stable key, not a transient row ID. Explicit reopen overrides the default reviewed state of a reversed duplicate.
- Re-ingesting unchanged evidence can retain review state. A merchant rename or a change to identity fields can produce a different key. Visiting the Alerts page removes saved reviews whose keys no longer correspond to a live alert; this is not an immutable investigation history.

## Future commitments and card economics

Sources: `latestStatementIds`, `installmentProjection`, `installmentBurden`, `activePlans`, `paymentFloat`, `bankTerms` in [queries](../../web/src/lib/queries.ts), and [projection](../../web/src/lib/projection.ts).

### Forecast

Default horizon is six months beginning after the latest purchase cycle month, with three distinct layers:

| Layer | Input and current rule |
| --- | --- |
| Certain | Sum forward installment schedules from the newest statement **per brand**; older schedules are superseded. BBVA schedules come from the statement; Mercado Pago schedules are reconstructed from remaining equal installments by its parser. |
| Expected | Active, high-confidence recurring merchants currently billed in ARS, each carried at its latest amount. USD subscriptions remain visible in Recurring but do not contribute to this layer, even in USD display mode. |
| Estimated | Trailing six available purchase months, excluding installment rows and the selected recurring merchants. Use the minimum and maximum **positive** monthly variable totals, rather than a probabilistic confidence interval or trend regression. |

Inflation is the geometric mean monthly IPC increase over up to six elapsed months. For forecast month offset `k` starting at 1, nominal recurring/variable spend grows by `(1 + inflation)^k`; these remain flat in real/USD modes. Nominal installment principal stays fixed; real installment values shrink by that factor. USD conversion uses available recent MEP without modeling future peso depreciation. Certain amounts are initially valued at the latest observed purchase month. Taxes are not independently projected: variable inputs can include allocated tax while expected/certain amounts do not consistently apply it.

The three layers must remain distinguishable from imported obligations and actual spending. UI visibility of a shared toggle does not mean every forecast component responds identically to it.

### Installments, float, and terms

- Historical installment burden is billed installment purchases versus billed one-offs. Plan count uses distinct merchant/count/date series within each bucket. Open plans use the newest statement per brand and ARS installments with remaining payments; nominal installment constancy underlies the remaining-principal estimate.
- Float uses positive ARS billed purchases, their original dates, and the associated statement due dates. `gain = amount × IPC(base)/IPC(purchase month) − amount × IPC(base)/IPC(due month)`. Delays are weighted by nominal billed amount. Missing due date assumes day 28 of the cycle month; negative delay is omitted; old CPI dates clamp to the first index and future due months use the latest available index. This models payment at due date without verifying actual settlement.
- Bank balances include native USD translated at monthly MEP. Utilization = combined nominal balance / available nominal purchase limit; minimum-payment ratio uses ARS balance only. Total limits are hidden when fewer than all historically seen brands are present; present-card balances and ratios can still be shown.
- Worst-card TEM is the highest available monthly effective rate; real TEM = `(1 + TEM)/(1 + monthly IPC change) − 1`. IPC change is undefined without both exact adjacent monthly indices. Mercado Pago's parser derives TEM from printed TEA by annual compounding.

## Supermarket analytics

Sources: [fact selection](../../web/src/lib/receipts/facts.ts), [valuation](../../web/src/lib/receipts/value.ts), [analytics](../../web/src/lib/receipts/analytics.ts), [verification](../../web/src/lib/receipts/verify.ts).

- Money is stored in integer cents and quantity in integer thousandths, in units or kilograms. Discounts are negative; `net = gross + discounts`. Printed unit price is evidence; analytical unit prices derive from gross/net line totals and quantity.
- One shopping period is one receipt, sorted by date, time, and receipt identity. It is not a weekly aggregation. Indicative monthly spending is **average receipt total × 4.33**, which assumes weekly shopping and is not a calendar-based forecast.
- Supermarket overview uses receipt totals; product/category analytics include only items with a product match. A matching failure can therefore leave overview spend present while product totals are incomplete; rematching is the recovery path.
- For price comparisons, multiple lines of the same product in one receipt become one quantity-weighted appearance. Product change compares its last two appearances, even if it skipped intervening receipts.
- The list/effective indices start at 100 and chain current quantities × current unit prices against the same quantities × each repeated product's most recent earlier unit prices. Newly seen products do not affect that link. No comparable products leaves the index flat.
- Savings by promotion family distinguish `M` (Mercado Pago), `A` (Coto), and mixed-tag items. An item's entire discount total goes in the mixed bucket if it has both tags; this is not a precise funding allocation per sponsor.
- “Essentials” appear in every receipt with at least two receipts available; “frequent” appear at least twice but not every time; “occasional” appear once. Entered/left products compare only the last two receipts, not lifetime first purchase or permanent discontinuation.
- Real/USD conversion happens before analytics, using the **receipt calendar month** and rounding individual monetary fields to cents. Independently rounded converted components can differ slightly from a converted receipt total. Exact-cent admission checks always use original printed ARS.

Receipt↔charge matching, correction rules, and identity guarantees are detailed in [data and workflows](data-and-workflows.md).
