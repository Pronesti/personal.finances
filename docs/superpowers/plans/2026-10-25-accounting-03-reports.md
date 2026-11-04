# Accounting Reports and Interface Parity Implementation Plan

Execution status (2026-10-25): pre-cutover implementation and all 46 acceptance scenarios pass. See [current implementation status](../../accounting/implementation-status.md) and the acceptance matrix for evidence. The user-approved live cutover under Task 16 is now complete; current proof is linked from the implementation status. Original step checkboxes are retained as the planning specification.


> **Execution:** Follow the user-selected execution method and repository requirements. This plan does not require any additional skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all existing reports, review/import screens and controls to the accounting-backed facts without losing their questions, evidence or bilingual behavior.

**Architecture:** Load typed facts once per request and run focused pure calculations. Keep existing components, routes, valuation helpers and product analytics where useful; change their data boundary rather than redesign every screen.

**Tech Stack:** Existing Next.js/React/Recharts, TypeScript/Vitest and the PostgreSQL adapters from Tasks 1–8.

**Spec:** [Master coverage ledger](2026-10-25-accounting-architecture.md#coverage-ledger), [features](../../current-state/features.md), [calculations](../../current-state/behavior.md), [preservation](../../current-state/preservation.md), [multilingual requirements](../../accounting/requirements.md#multilingual-preservation-and-new-accounting-features).

## Global Constraints

- **DO NOT IMPLEMENT** during planning. Inherit master constraints and execute after Tasks 1–8.
- Default backend remains SQLite until release proof. A selected PostgreSQL page must not silently load its figures/actions from SQLite.
- Purchase-period expense, billed-cycle burden, actual payments and debt balances remain separate measures. IPC/MEP never modify journal values.
- Do not approve unrelated calculation fixes through new test expectations. Record accepted versus unexplained differences explicitly.
- New or changed copy, validation, chart labels and accessibility labels ship in English and Spanish together.

## Review Focus

1. A quarter must convert each constituent month, not apply one quarter-end MEP/IPC rate — Task 10.
2. Purchase count, credits and installments must not duplicate acquisition decisions — Task 10.
3. Same-brand card schedules and partial coverage must remain distinguishable — Task 11.
4. Receipt quantities combine before unit-price comparison; unreviewed matches must not masquerade as reliable product history — Task 12.
5. Locale switches and duplicate labels must preserve IDs, values, filters and unsaved form state — Tasks 9/12.

---

## File map and report contract

Create `web/src/lib/accounting/read-model.ts`, `reports/{spending,timing,commitments,supermarket}.ts` and corresponding `.test.ts` files only when their task needs them. Create `web/src/lib/backend.ts` and `backend.test.ts`. Modify the exact current route files linked in the feature inventory and their existing colocated client components; do not invent a new navigation redesign. All 28 static page paths plus `receipts/[id]` are in that inventory. Modify `app/layout.tsx`, `lib/params.ts` and shared chrome only at their source-loading seam.

The read model is an accounting/reporting fact boundary, not a cache, second ledger or event projector. Keep it separate from the write port: define `AccountingReader` with `facts(): Promise<ReportFact[]>`, `receiptFacts(): Promise<{ receipts: ReceiptFact[]; items: ItemFact[] }>`, `receiptAllocations(): Promise<ReceiptAllocationFact[]>`, `statements(): Promise<StatementFact[]>`, `schedules(): Promise<ScheduleFact[]>` and `close(): Promise<void>`. The concrete `createPostgresReader(connectionString: string, schema?: string): AccountingReader` lives in `postgres.ts`; `createMemoryReader(input: { facts?: ReportFact[]; receipts?: ReceiptFact[]; items?: ItemFact[]; allocations?: ReceiptAllocationFact[]; statements?: StatementFact[]; schedules?: ScheduleFact[] } = {}): AccountingReader` lives in test support. The first two receipt types are the existing pure data shapes; `ReceiptAllocationFact` is `{ receiptId: number; itemId: string; accountId: string | null; purposeId: string | null; netMinor: number; reviewed: boolean }`. Never make the domain transaction port depend on report-specific types. Define these exact fields in Task 9:

```ts
export type ReportFact = {
  id: string; purchaseId: string | null; cardId: string;
  kind: "purchase" | "billing" | "payment" | "credit" | "cost" | "opening";
  merchant: string | null; accountId: string | null; purposeId: string | null;
  currency: "ARS" | "USD"; minor: number;
  effectiveDate: string; cycleMonth: string | null;
  sourceLineId: string | null; statementId: string | null; coverage: "complete" | "opening" | "uncertain";
};
export type ReportScope = {
  basis: "purchase" | "billed"; value: "nominal" | "real" | "usd";
  tax: "excl" | "incl"; granularity: "month" | "quarter" | "year" | "all";
  period: string | null;
};
export type SpendRow = { period: string; accountId: string; purposeId: string | null; amount: number };
export type StatementFact = {
  id: string; cardId: string; sourceRevisionId: string; current: boolean;
  closingDate: string; previousClosingDate: string | null; dueDate: string | null;
  cycleMonth: string; balanceArsMinor: number | null; balanceUsdMinor: number | null;
  previousBalanceArsMinor: number | null; minimumPaymentArsMinor: number | null;
  purchaseLimitArsMinor: number | null; tnaPct: number | null; temPct: number | null;
};
export type ScheduleFact = {
  cardId: string; revisionId: string; current: boolean; month: string; amount: number;
};
```

`minor` is signed for credits; exact ledger cents remain separate from display/report major-unit `amount`. Purchase facts use the latest accepted version, including Q29 original effective period; supported billing facts retain issuer cycle month. Opening debt is not current purchase spending. Preserve source-dated observations for historical coverage explanation rather than fabricating an acquisition. Factor report functions around these facts; do not make a browser component interpret debit/credit journals.

## Tasks

### Task 9: Explicit backend boundary and accounting inspection

**Files:** Create `web/src/lib/{backend.ts,backend.test.ts}`, `accounting/read-model.ts`, `read-model.test.ts`, `web/src/app/accounting/page.tsx`; modify `app/layout.tsx`, `components/Nav.tsx`, `lib/params.ts`, `lib/i18n.ts`, current API handlers and the route-loader boundary of every feature page listed in the inventory. Read installed Next routing/caching/server-action docs before edits.

**Interfaces:** Produce `selectedBackend(env: Record<string, string | undefined>): "sqlite" | "postgres"`, `loadReportFacts(reader: AccountingReader): Promise<ReportFact[]>`, `backendForPage(page: PageId): Promise<PageBackend>`. `PageId` is a literal union of the 29 inventory route paths (including the pattern `/receipts/[id]`) plus `/accounting` and the internal `chrome` key; define it from that exact inventory here. `PageBackend` is `{ kind: "sqlite"; db: Database.Database } | { kind: "postgres"; ledger: LedgerPort; reader: AccountingReader; facts: ReportFact[] } | { kind: "unavailable"; code: "accounting_page_not_ready" }`. This is an adapter type; neither Next nor SQLite enters the domain. Ready-page membership is a small explicit set in this file, grown only by the owning tested task.

- [ ] **Step 1: Write the red backend tests.** Unknown settings fail rather than select a fallback.

```ts
import { expect, it } from "vitest";
import { selectedBackend } from "./backend";
it("selects one explicit data source", () => {
  expect(selectedBackend({})).toBe("sqlite");
  expect(selectedBackend({ TARJETAS_BACKEND: "postgres" })).toBe("postgres");
  expect(() => selectedBackend({ TARJETAS_BACKEND: "postgre" })).toThrow("invalid_backend");
});
```

- [ ] **Step 2:** Run backend/read-model tests. Add a spy seam in the composition test: when PostgreSQL is selected, an attempted legacy `getDb()` throws; loading chrome/accounting/import models must still succeed on their PG fixtures. A not-ready page returns the explicit unavailable result without reading SQLite. Verify `TARJETAS_DATABASE_URL` is required only for the selected PG path, never on a default app build/module import.
- [ ] **Step 3:** Implement the single branch in `backend.ts`. Update each page loader to call `backendForPage` before any DB query and render the bilingual unavailable state for a not-ready PG page. Legacy default calls remain unchanged. New PG pages appear in navigation only when their complete model/action path is ready. The root layout/chrome uses the selected backend for month coverage/latest closing; it cannot call SQLite first and switch later.

```ts
export function selectedBackend(env: Record<string, string | undefined>): "sqlite" | "postgres" {
  const value = env.TARJETAS_BACKEND ?? "sqlite";
  if (value !== "sqlite" && value !== "postgres") throw new Error("invalid_backend");
  return value;
}
```

- [ ] **Step 4:** Build PG read facts from posted journals, current purchase versions, supported billings, payments and active evidence links. Validate sums against journal balances; preserve unattributed/opening and pending review rows. No forecast projection becomes a posted fact. Use repeatable-read request loading when several report queries must agree across a concurrent import/correction.
- [ ] **Step 5:** Add `/accounting` as a minimal readable journal/account/purpose inspection page in PG mode: native balances, separate billed/unbilled principal, signed unresolved clearing, purchase/evidence links, effective and recorded times, audit chain and pending review. This is not a freeform journal-entry UI. Use existing layout/table/chart patterns and local translations.
- [ ] **Step 6:** Connect current statement/receipt/corrected API handlers to the selected ready backend using Tasks 5–7. Preserve 400 validation, 422 receipt-rejection shape and structured JSON 500 responses; localize unexpected-error explanations rather than exposing worker/database messages. Their list/detail pages must use the same selected data source before marking imports ready. Test GET-after-POST behavior, failed correction and language-specific errors from the same codes.
- [ ] **Step 7:** Manual check in both modes: no-DB default works, PG missing config shows understandable setup error, one synthetic purchase is traceable, not-ready routes do not show mixed data, navigation/query settings remain intact. Run focused/PG/full/type/build checks; checkpoint `feat: add explicit accounting backend and inspection`.

### Task 10: Spending, drill-down, timing and cross-type group measures

**Files:** Create `accounting/reports/spending.ts`, `timing.ts`, `spending.test.ts`, `timing.test.ts`; modify `app/{trends,categories,merchants,movers,compare,sankey,calendar,habits,pace,currency}/page.tsx`, their existing client components and category actions; extend backend ready set, i18n and read-model tests. Read `queries.ts` and `scope.ts` before extracting useful pure functions.

**Interfaces:** Produce `spendRows(facts: ReportFact[], scope: ReportScope, rates: { cpi: CpiTable; mep: MepTable }): SpendRow[]`, `spendingModel(facts, scope, rates): { rows: SpendRow[]; total: number; purchaseCount: number; merchantTotals: { merchant: string; amount: number }[] }`, and `timingModel(facts, scope, rates): { days: { date: string; amount: number; purchaseCount: number }[]; medianTicket: number | null }`. Export `purposeMeasures(port, input: { cardId: string; currency: Currency; from: string; to: string }): Promise<{ purposeId: string | null; expenseMinor: number; debtMinor: number; repaymentMinor: number }[]>`. All parameter types not repeated are the exact `ReportFact[]`, `ReportScope` and rates types above, not arbitrary records.

- [ ] **Step 1: Add the red test** for purchase versus billed modes and opening-debt exclusion.

```ts
import { expect, it } from "vitest";
import { spendRows } from "./spending";
import type { ReportFact, ReportScope } from "../read-model";
it("keeps a 600 purchase separate from its 100 billed installment", () => {
  const base = { purchaseId: "p", cardId: "a", merchant: "SHOP", accountId: "food",
    purposeId: "food", currency: "ARS" as const, effectiveDate: "2026-01-15",
    cycleMonth: "2026-02", sourceLineId: "line", statementId: "statement-a", coverage: "complete" as const };
  const facts: ReportFact[] = [
    { ...base, id: "purchase", kind: "purchase", minor: 60000 },
    { ...base, id: "bill", kind: "billing", minor: 10000 },
    { ...base, id: "opening", kind: "opening", minor: 90000, coverage: "opening" },
  ];
  const scope: ReportScope = { basis: "purchase", value: "nominal", tax: "excl", granularity: "month", period: null };
  expect(spendRows(facts, scope, { cpi: {}, mep: {} })).toEqual([
    { period: "2026-01", accountId: "food", purposeId: "food", amount: 600 },
  ]);
  expect(spendRows(facts, { ...scope, basis: "billed" }, { cpi: {}, mep: {} })[0].amount).toBe(100);
});
```

- [ ] **Step 2:** Run the two report files. Implement basis selection before period aggregation: acquisition/effective dates for purchase view under Q8, issuer cycles for billed view, no payment/opening-debt expense. Resolve current account allocations by identity and retain source drill evidence. URL `accrual`/`cash` values may remain compatibility aliases, but copy says purchase/as billed, not cash paid.
- [ ] **Step 3:** Preserve monthly-before-quarter/year conversion, signed refunds, tax inclusion/exclusion, missing rates/coverage, zero-base null deltas and documented ordinary-peso/native-USD distinction. Add concrete test amounts: ARS 1000 at MEP 1000 in January and ARS 1000 at MEP 2000 in February yield USD 1.5 for the quarter; a raw USD 5 credit/purchase nets natively. Reference refresh changes report valuation only.
- [ ] **Step 4:** Define the remaining pure page adapters in the owning report files: `drillModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates, path: { accountId: string | null; merchant: string | null }): { rows: ReportFact[]; total: number }`, `merchantModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates): { totals: { merchant: string; amount: number; share: number; cumulativeShare: number }[]; novelty: { period: string; newAmount: number; returningAmount: number }[] }`, `moverModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates): { accountId: string; before: number; after: number; delta: number; pct: number | null }[]`, `flowModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates): { nodes: { id: string; labelId: string }[]; links: { sourceId: string; targetId: string; amount: number }[] }` and `paceModel(facts: ReportFact[], statements: StatementFact[], scope: ReportScope, rates: ReportRates): { cardId: string; cycleMonth: string; points: { day: number; cumulative: number }[]; priorMedian: { day: number; cumulative: number }[] }[]`. `ReportRates` is the exported alias `{ cpi: CpiTable; mep: MepTable }`. Every chart key/color uses stable account/purpose/series IDs; translated labels are not data keys. Implement drill/breadcrumb/evidence navigation, merchant alias totals/novelty/concentration, category movers and positive-net Sankey paths using these typed models and current primary purpose. Add separate account/group navigation so custom overlapping groups do not become false additive categories. No grouping operation adds expense activity to outstanding debt.
- [ ] **Step 5:** Implement calendar/weekday/purchase-count/ticket median using one positive economic acquisition, refunds without extra visits, card-specific cycle pace and observed coverage. Test tickets 100/300 → median 200, two real equal purchases count twice, six installments count one decision, and two same-brand cards use their distinct cycle windows.
- [ ] **Step 6:** Implement `purposeMeasures`: debt is the point-in-time balance at `to`, while expense activity and repayments are flows from `from` through `to`. Use latest corrected classifications with financially effective entries through that boundary, not a separate as-originally-reported mode. Derive debt from supported purchase allocations and Q31 active repayment attribution, plus explicit unattributed/opening/unapplied components; expense and repayment are separate columns. Assert component debt reconciles to total card balance and custom overlaps are labeled non-additive. Test a past classification correction updates historical purpose and current debt attribution without changing the total repayment.
- [ ] **Step 7:** Wire one route at a time using its typed model, with the explicit unavailable guard from Task 9. Do not edit all report components before running a check. Each row below is a separate reviewable increment: keep its ready-page entry disabled until its scoped test, both-language interaction and affected master checks pass. Preserve a checkpoint after each row; if commits are authorized, suffix `feat: migrate accounting report` with the route name.

| Increment | Exact page path under `web/src/app/` | Model/observable check before enabling |
| --- | --- | --- |
| 10a | `trends/page.tsx` | `spendRows`: monthly-first conversion and stacked account/purpose totals |
| 10b | `compare/page.tsx` | Period totals/coverage, zero previous total yields no infinite percentage |
| 10c | `categories/page.tsx` and `categories/actions.ts` | Account/group drill to merchant/source/receipt; selected correction affects only that purchase |
| 10d | `merchants/page.tsx` | Net concentration/novelty and aliases preserve two distinct equal purchases |
| 10e | `movers/page.tsx` | Contributions sum to latest-period change, new category has an amount not infinity |
| 10f | `sankey/page.tsx` | Positive-net incoming/outgoing totals reconcile, overlaps do not inflate spending |
| 10g | `calendar/page.tsx` | One acquisition day per purchase, linked receipt reachable |
| 10h | `habits/page.tsx` | Counts/weekday/ticket median 100/300 → 200 |
| 10i | `pace/page.tsx` | Distinct card windows and completed short-cycle coverage |
| 10j | `currency/page.tsx` | Native evidence and per-month conversion, explicit ordinary-peso versus USD-inclusive lens |

Run the owned `spending.test.ts`/`timing.test.ts` assertions relevant to each row and preserve P04/P05/P08–P12/P14 and T01–T04/T08/T09/T14/T16. Pure report functions can be shared; the route-ready and user-visible check cannot be inferred from another page's success.

### Task 11: Overview, alerts, recurrence, finance and commitment reports

**Files:** Create `accounting/reports/commitments.ts`, `commitments.test.ts`; extend read-model and backend; modify `app/page.tsx`, `app/{anomalies,recurring,inflation,taxes,credits,float,future,installments,bank}/page.tsx` and their actions/client components. Reuse `recurring.ts`, `projection.ts`, `inflation.ts`, `anomalies.ts`, `cpi.ts`, `mep.ts` and `months.ts` where pure boundaries already fit; do not create duplicate algorithms.

**Interfaces:** Produce `commitmentModel(input: { schedules: { cardId: string; revisionId: string; current: boolean; month: string; amount: number }[]; recurring: RecurringCharge[]; variableHistory: number[]; startMonth: string; inflation: number; value: ValueMode }): { forecast: ProjectionMonth[]; remainingPrincipal: number }`. `remainingPrincipal` is supported schedule-derived committed burden, labeled with coverage; it is never added again to booked debt. Reuse existing `RecurringCharge`, `ProjectionMonth`, `ValueMode` types through type-only imports or move them to a shared pure types file only when a dependency cycle requires it.

- [ ] **Step 1: Add the red forecast test.** It checks schedule supersession per actual card rather than current brand-level approximation.

```ts
import { expect, it } from "vitest";
import { commitmentModel } from "./commitments";
it("uses only current schedules without combining same-brand card identity", () => {
  const result = commitmentModel({ schedules: [
    { cardId: "a", revisionId: "old", current: false, month: "2026-02", amount: 900 },
    { cardId: "a", revisionId: "new", current: true, month: "2026-02", amount: 100 },
    { cardId: "b", revisionId: "b1", current: true, month: "2026-02", amount: 200 },
  ], recurring: [], variableHistory: [], startMonth: "2026-02", inflation: 0, value: "nominal" });
  expect(result.forecast).toHaveLength(6);
  expect(result.forecast[0].certain).toBe(300);
});
```

- [ ] **Step 2:** Run the new file and existing recurrence/projection/inflation/anomaly tests. Use normalized billed observations for recurrence/price comparison; financing installment payments must not create an apparent new recurring service purchase. Preserve month coverage, high/low confidence, lapsed status and currency-migration rules.
- [ ] **Step 3:** Build six-month certain/expected/variable layers using current issuer schedules with card identity, separate known debt from estimated purchases and disclose unavailable schedule coverage. Preserve current forecast treatment of USD recurring and FX assumptions as explicit baseline behavior; expanding those models requires a separately agreed behavior change. No forecast step posts journals.
- [ ] **Step 4:** Rebuild taxes/fees/interest and linked-credit views from separate financial roles, retaining issuer legal identifiers/raw labels. Own payments are excluded from money-back. Unsupported recoverability/unlinked rewards remain reviewable rather than becoming income by default. Test principal repayment versus interest and the 1000/-200 net-credit example.
- [ ] **Step 5:** Preserve real-peso float assumptions (due-date model, no claim of actual settlement), minimum-payment/limit/TEM metrics, official IPC basket indexing and native-currency units. Missing rates, due dates and partial card coverage follow the documented fallback or explicitly explained incompleteness. The existing `/bank` page remains issuer terms; it does not add bank-account functionality.
- [ ] **Step 6:** Connect retained/computed alerts to stable review history and overview counts/tiles. Test duplicate/jump/new-merchant evidence, state transitions/reopen, zero-base periods, after-correction alert history, monthly IPC/MEP refresh and overview forecast/top-category agreement. Update reference scripts to use the selected target consistently; keep reference series outside immutable journal valuation.
- [ ] **Step 7:** Connect and verify these independent route increments in order: `/recurring`, `/inflation`, `/taxes`, `/credits`, `/float`, `/installments`, `/future`, `/bank`, `/anomalies`, then `/` once its tiles can reconcile to the completed models. Each uses its exact current page/action files above; run the related existing calculation test plus `commitments.test.ts`, perform its P03/P13/P15–P19 check in both languages and run affected master checks before enabling its ready-page entry. Preserve a separate checkpoint per route, rather than one ten-page diff. Suggested authorized commit prefix: `feat: migrate accounting commitments report` plus the route name.

### Task 12: Supermarket reports, full review UI and multilingual parity

**Files:** Create `accounting/reports/supermarket.ts`, `supermarket.test.ts`, `multilingual.test.ts`; modify `app/super/page.tsx`, `app/super/{products,categories,charges,review}/page.tsx`, `app/receipts/page.tsx`, `app/receipts/[id]/page.tsx`, associated actions/components, `app/review/page.tsx`, existing category/anomaly actions and `components/{LangToggle,I18nProvider,Nav}.tsx` only where a preservation defect is established. Extend `i18n.ts`/tests and receipt facts loading.

**Interfaces:** Produce `loadReceiptAnalytics(reader: AccountingReader): Promise<{ analytics: Analytics; accountMatrix: ReceiptAllocationRow[] }>` using `reader.receiptFacts()` followed by the existing `buildAnalytics(receipts: ReceiptFact[], items: ItemFact[]): Analytics`, and separately `receiptAllocationMatrix(rows: ReceiptAllocationFact[]): ReceiptAllocationRow[]`, where `ReceiptAllocationRow` is `{ receiptId: number; accountId: string; totalMinor: number }`. `ReceiptFact`, `ItemFact` and `Analytics` are existing receipt types. The old product department/category enum may remain legacy/product detail but must not be promoted into the new account chart or used as its account matrix. Keep a stable legacy-to-new receipt/product ID mapping where the current numeric view contract needs it; never derive identity from a translated product name. Produce `accountingMessage(input: { code: string; messageKey: MessageKey; params: Vars }, locale: Locale): string` as a presentation function for retained structured messages.

- [ ] **Step 1: Add the red bilingual identity test.** Use the Task 3 label resolver and seeded complete catalog key.

```ts
import { expect, it } from "vitest";
import { resolveLabel } from "./catalog";
import { accountingMessage } from "./reports/supermarket";
it("keeps custom names literal while rendering the same retained error in either language", () => {
  const named = { customName: "Mi casa", labelKey: "accounting.account.household" };
  expect(resolveLabel(named, "en")).toBe("Mi casa");
  expect(resolveLabel(named, "es")).toBe("Mi casa");
  const error = { code: "unbalanced_journal", messageKey: "accounting.error.unbalanced" as const,
    params: { debit: "100,00", credit: "99,99" } };
  expect(accountingMessage(error, "en")).toContain("99,99");
  expect(accountingMessage(error, "es")).toContain("99,99");
  expect(accountingMessage(error, "en")).not.toBe(accountingMessage(error, "es"));
});
```

- [ ] **Step 2:** Add dictionary keys in both languages using complete messages, e.g. English `Debits {debit} do not match credits {credit}.`, Spanish `Los débitos {debit} no coinciden con los créditos {credit}.` Reuse translator interpolation/fallback and structured Failure conventions. Unknown/internal errors get localized generic explanations plus stable codes, not raw database prose. Run the i18n and new multilingual tests red/green.
- [ ] **Step 3:** Load gross/net cents, quantities, unit/canonical identity, discounts/promo tags and reviewed product matches from PG. Reuse `buildAnalytics` for prices, quantities, savings and baskets instead of rewriting it. Add the separate new-account matrix from reviewed item allocations; unreviewed/unallocated net amounts remain visibly Unallocated, not silently omitted or assigned by the old department. Test 7000 groceries/2000 household/1000 pets totals 10000 for one receipt and one purchase. Known-bad product mappings remain reviewable rather than entering trusted price comparisons; retain source item totals regardless. Test same product appearing twice combines quantities before weighted unit price; gross/effective indices differ with promotions; frequency and last-two-basket changes remain correct.
- [ ] **Step 4:** Connect every receipt and product review action to the same backend as its view: upload/rejection/correct/retry/detail, candidate matching/manual link/unlink, product rename/category/unit/merge/code-move/rematch. Merchant proposal acceptance/rejection and selected/future/history correction controls use Task 8 scopes. Do not lose exact-cent or transcript displays by applying rounded report formatters to receipt detail.
- [ ] **Step 5:** Finish new account/group naming and membership editing using stable IDs, primary purpose and Q32 single custom label; translations apply only to built-in concepts and interface prose. Reject blank/invalid custom names, preserve duplicate-label identities, and show expense/debt/repayment measures separately. Test custom renames do not alter ledger lines or source facts.
- [ ] **Step 6:** Run existing key/placeholder/plural coverage plus label coverage for every seeded built-in account/group/state/error. Add fallback behavior assertions, missing variable checks, same-label chart series identity, Argentine source parsing under both UI languages and unchanged native/report values after switching.
- [ ] **Step 7:** Manual desktop/narrow-screen walkthrough in English and Spanish: navigation/sidebar/mobile menu, light/dark, wide tables, keyboard controls/accessibility labels, chart tooltips, source evidence, error/review messages and all new-account forms. Switch language with selected account/period/valuation and an unsaved custom-name draft; preserve the values or explicitly handle the draft before any loss. Do not change `LangToggle` refresh mechanics unless this acceptance actually fails.
- [ ] **Step 8:** Complete separate visible increments for `/receipts` plus `/receipts/[id]`, `/super/charges`, `/super/review`, `/super`, `/super/products`, `/super/categories` and `/review`, in that dependency order. For each increment, wire its matching actions/backend model, run its existing receipt/product/LLM test and the new relevant report test, then walk its bilingual P20–P26 scenario before enabling its route-ready entry. Preserve a separate checkpoint per increment. Finish T17–T19, all route-ready entries and full default tests/type/build/PG integration; suggested authorized commit prefix: `feat: migrate accounting receipt workflow` plus the route name.

## Exit gate

- [ ] Every F01–F33 capability has a selected-backend path, or the specifically operational part is owned by Tasks 13–16. No unfinished production route falls back to another dataset.
- [ ] Read models reconcile with posted native balances and active evidence; forecast totals are never mistaken for debt or added expense.
- [ ] Both language modes and selected/future/history correction scopes pass visible workflow checks.
- [ ] Continue with [Tasks 13–16](2026-10-25-accounting-04-operations.md); passing report fixtures alone is not permission for live cutover.
