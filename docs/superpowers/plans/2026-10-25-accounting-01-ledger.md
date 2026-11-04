# Accounting Ledger Foundation Implementation Plan

Execution status (2026-10-25): pre-cutover implementation and all 46 acceptance scenarios pass. See [current implementation status](../../accounting/implementation-status.md) and the acceptance matrix for evidence. The user-approved live cutover under Task 16 is now complete; current proof is linked from the implementation status. Original step checkboxes are retained as the planning specification.


> **Execution:** Follow the user-selected execution method and repository requirements. This plan does not require any additional skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post and inspect a synthetic purchase, installment billing, repayment and correction through the real PostgreSQL transaction boundary.

**Architecture:** Pure TypeScript decisions plus a small transaction port; PostgreSQL and memory adapters implement the same atomic behavior. Use a small operator CLI to exercise complete paths before connecting existing UI/imports.

**Tech Stack:** Existing TypeScript/Vitest/tsx, PostgreSQL 18, `pg`, parameterized SQL. No ORM.

**Spec:** [Master plan and file map](2026-10-25-accounting-architecture.md), [requirements](../../accounting/requirements.md), [Q8](../../accounting/installments.md), [chart](../../proposals/personal-chart-of-accounts.md), [T01–T19](../../current-state/preservation.md).

## Global Constraints

- **DO NOT IMPLEMENT** during the planning delivery. All checkboxes describe future work.
- Inherit every [master constraint](2026-10-25-accounting-architecture.md#global-constraints), especially native-currency balance, evidence retention, Q29 dates and the isolated database rule.
- Do not change legacy SQLite schema/imports or run the new CLI without an explicit isolated target.
- Dependencies flow from adapters into use cases/domain; domain imports no Next.js, `pg`, SQLite, filesystem, translation or OCR code.
- Checkpoints are verified diffs; commits require separate authorization.

## Review Focus

1. ARS and USD lines that only balance after conversion must be rejected — Task 1 journal test.
2. Concurrent retries with the same key must produce one result; changed content under that key must fail — Task 1 PG test.
3. Billing does not pay principal, and a larger repayment must not silently consume unbilled principal — Task 2 test.
4. Corrections after repayments must preserve old entries and recompute analytical attribution — Task 3 test.
5. Same-brand cards, duplicate equal purchases and incomplete installment evidence must not collapse — Task 4 identity tests.

---

## Files and concrete contracts

Create the modules named in the master map only as their owning task needs them. Proposed IDs are opaque strings, not localized labels or card brands. Money is an integer number of cents and dates are validated `YYYY-MM-DD` strings, never guessed from server timezone. An accounting error has a stable code and parameter record; the Next adapter later chooses translated prose.

Task 1 establishes these types in `model.ts` and `port.ts`; later tasks add only the named operations they use:

```ts
export type Currency = "ARS" | "USD";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = {
  id: string; parentId: string | null; type: AccountType;
  labelKey: string | null; customName: string | null;
  currency: Currency | null; primaryPurposeId: string | null;
  posting: boolean; enabled: boolean;
};
export type Line = {
  accountId: string; debitMinor: number; creditMinor: number;
  purchaseId: string | null; purposeId: string | null;
};
export type Journal = {
  id: string; commandKey: string; cardId: string; currency: Currency;
  effectiveDate: string; recordedAt: string;
  kind: "purchase" | "billing" | "repayment" | "credit" | "cost" | "opening" | "reversal" | "replacement";
  reversesId: string | null; evidenceIds: string[]; lines: Line[];
};
export type PostResult = {
  status: "posted" | "duplicate" | "review";
  journalIds: string[]; reviewCode: string | null;
};
export type CommandReceipt = { key: string; digest: string; result: PostResult };
export interface LedgerTx {
  command(key: string): Promise<CommandReceipt | null>;
  account(id: string): Promise<Account | null>;
  appendJournal(journal: Journal): Promise<void>;
  appendCommand(receipt: CommandReceipt): Promise<void>;
}
export interface LedgerPort {
  transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T>;
  journals(cardId: string): Promise<Journal[]>;
}
```

`transaction` acquires the installation writer lock and rolls back *every* write on failure. It can retain source evidence before a card is known. The memory adapter stages a copy and publishes it only on success, with the same writer serialization. Command keys are qualified internally as `card:<id>:<key>`, `source:<hash>:<key>` or `catalog:<key>`; different cards may reuse an external request key without colliding. Do not expose arbitrary SQL through this port. Shared catalog editing is a separate concrete adapter operation, not a reason for a generic repository framework.

## Tasks

### Task 1: Balanced, atomic posting through PostgreSQL and CLI

**Files:** Create `web/src/lib/accounting/{model,journal,port,use-cases,memory,postgres,test-support}.ts`, `journal.test.ts`, `postgres.integration.test.ts`, `migrations/001-ledger.sql`; create `web/scripts/accounting.ts`; modify `web/package.json` and lockfile when execution is authorized. Read `web/vitest.config.ts`, `web/tsconfig.json`, `web/src/lib/failure.ts` and the installed Next guides before any framework change.

**Interfaces:** Consume `Journal`, `LedgerPort`. Produce `validateJournal(journal: Journal): void`, `postJournal(port: LedgerPort, journal: Journal, digest: string): Promise<PostResult>`, `createMemoryLedger(): LedgerPort`, `createPostgresLedger(connectionString: string, schema?: string): LedgerPort & { close(): Promise<void> }`, `migrateAccounting(connectionString: string, schema?: string): Promise<void>`. `test-support.ts` produces `balancedJournal(overrides?: Partial<Journal>): Journal` and `withTestLedger(work: (port: LedgerPort) => Promise<void>): Promise<void>`; the latter creates/drops a unique isolated schema, closes the pool in `finally`, and never touches the source SQLite file. The schema argument accepts only an internally generated `acct_test_` plus hexadecimal suffix for tests; application migrations use the fixed configured schema. Seed synthetic card/account/evidence rows only inside test/demo setup, never as fake production records.

- [ ] **Step 1: Write the red unit test.** The fixture uses card `card-a`, expense `expense:unallocated`, liability `card-a:ARS:unbilled`, evidence `synthetic:e1`, a 60000-cent purchase dated `2026-01-15` and `recordedAt=2026-01-16T12:00:00Z`. Define `balancedJournal` with those literal values in this task.

```ts
import { expect, it } from "vitest";
import { validateJournal } from "./journal";
import { balancedJournal } from "./test-support";
it("rejects a one-cent imbalance and fractional minor units", () => {
  const j = balancedJournal();
  j.lines[1].creditMinor = 59999;
  expect(() => validateJournal(j)).toThrow("unbalanced_journal");
  j.lines[1].creditMinor = 60000;
  j.lines[0].debitMinor = 0.5;
  expect(() => validateJournal(j)).toThrow("invalid_minor_units");
});
```

- [ ] **Step 2:** Run `cd web && npx vitest run src/lib/accounting/journal.test.ts`. Expect a missing-module/export failure, then the intended behavioral failure once exports exist.
- [ ] **Step 3: Implement validation.** Reject non-ARS/USD currency, invalid real calendar dates, missing evidence for non-synthetic commands, fewer than two lines, both/neither positive debit and credit, noninteger/negative/unsafe minor values, and unsafe accumulated totals. Validate account existence, enabled posting status, allowed currency and leaf-account eligibility in the use case.

```ts
const exact = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid_minor_units");
  return n;
};
const add = (a: number, b: number) => exact(a + b);
// In validateJournal, after validating identity/date/evidence:
const debit = journal.lines.reduce((n, l) => add(n, exact(l.debitMinor)), 0);
const credit = journal.lines.reduce((n, l) => add(n, exact(l.creditMinor)), 0);
if (debit === 0 || debit !== credit) throw new Error("unbalanced_journal");
```

- [ ] **Step 4: Add the port and atomic memory adapter.** `postJournal` checks the saved command inside `transaction`, returns original journal IDs for equal digests with status `duplicate`, rejects unequal digests with `command_conflict`, then appends journal and receipt together. Digest canonical command inputs only; exclude generated IDs and actual recorded time so a network retry is stable.
- [ ] **Step 5: Add `pg` and its TypeScript declarations at execution time.** Run `npm install pg` and `npm install --save-dev @types/pg` from `web/`; inspect/update the lockfile and actual type compatibility. Add `"accounting": "tsx scripts/accounting.ts"` and `"test:accounting:pg": "ACCOUNTING_PG_TESTS=1 vitest run src/lib/accounting/postgres.integration.test.ts"`. Opted-in tests throw on a missing `ACCOUNTING_TEST_DATABASE_URL`; ordinary unit runs skip this one integration file before any connection is made.
- [ ] **Step 6: Write migration 001.** Create `schema_migrations`, `cards`, `accounts`, `commands`, `journals`, `journal_lines`, `journal_evidence` and synthetic-test evidence metadata. Use UUID/text keys, a unique fully qualified command key with an optional card reference, required foreign keys, `DATE` effective dates and `TIMESTAMPTZ` recording time. `BIGINT` money checks enforce `0..9007199254740991`; line checks permit exactly one positive side. Account hierarchy has a same-type parent, no cycles, and posted accounts cannot be removed.

```sql
-- Column fragment for journal_lines; apply it in the complete migration.
debit_minor BIGINT NOT NULL CHECK (debit_minor BETWEEN 0 AND 9007199254740991),
credit_minor BIGINT NOT NULL CHECK (credit_minor BETWEEN 0 AND 9007199254740991),
CHECK ((debit_minor > 0 AND credit_minor = 0)
    OR (credit_minor > 0 AND debit_minor = 0))
```

- [ ] **Step 7: Enforce posting lifecycle in PostgreSQL.** Insert header in `draft`, insert lines/evidence, then finalize to `posted` in the same transaction. A `BEFORE UPDATE` finalization trigger checks at least two lines, matching positive sums, evidence and account-currency compatibility. Posted headers cannot update/delete and their lines/evidence cannot insert/update/delete; corrections append other journals. Guard the parent row during line writes. All report queries exclude `draft`; an application error leaves neither a posted header nor a command receipt. Cross-row sums belong in this finalization guard, not an impossible cross-table `CHECK`. Down migration is for a new disposable test schema only; never delete a populated live ledger to undo a code release.
- [ ] **Step 8: Implement PostgreSQL transaction plumbing.** Acquire one client, `BEGIN`, acquire `SELECT pg_advisory_xact_lock(8581401)`, execute work, `COMMIT`, release; on failure `ROLLBACK`, release, rethrow a structured application error. Read BIGINT values as strings and range-check before conversion. Migrations run via `accounting migrate --target test|staging`; require an explicit URL and reject a missing target. Nothing migrates on module import or HTTP request.
- [ ] **Step 9: Add real PG assertions.** `Promise.all` two equal post commands yields one journal; conflicting digests fail. Force failure after lines but before command append: neither survives. Raw SQL attempts to finalize an unbalanced journal or alter a posted line fail. A USD journal using ARS-restricted card accounts fails even if a report conversion could make totals match.
- [ ] **Step 10:** Run the focused unit file and explicit PG test command against a disposable database. Add a CLI `demo --target test` using `balancedJournal`-equivalent synthetic values that prints the posted journal and balances through `port.journals`; refuse a live/default URL. Run the master verification commands. Checkpoint message, only if commits are authorized: `feat: add atomic native-currency ledger posting`.

### Task 2: One purchase, installment billing, repayments and linked credits

**Files:** Create `web/src/lib/accounting/{purchases,attribution}.ts`, `purchases.test.ts`, `attribution.test.ts`, `migrations/002-purchases.sql`; extend `model.ts`, `port.ts`, both adapters, `use-cases.ts`, `test-support.ts` and CLI.

**Interfaces:** Produce the following exact input/use-case surface; `recordedAt` is injected actual time and does not alter digest identity. Add `purchase(id)`, `appendPurchase(version)`, `billings(purchaseId)`, `appendBilling(billing)`, `billedComponents(currency)`, `appendPayment(payment)` and `appendAttributions(rows)` to `LedgerTx`. Define each row's IDs, source references, native minor amounts and dates in `model.ts` in this task; payment attributions record `method: "issuer" | "oldest_billed_first"`, target component and attributed minor units.

```ts
export type PurchaseInput = {
  key: string; purchaseId: string; cardId: string; currency: Currency;
  effectiveDate: string; recordedAt: string; evidenceIds: string[];
  principalMinor: number;
  allocations: { accountId: string; purposeId: string; minor: number }[];
};
export type BillingInput = {
  key: string; purchaseId: string; cardId: string; currency: Currency;
  installment: number; amountMinor: number;
  effectiveDate: string; recordedAt: string; evidenceIds: string[];
};
export type PaymentInput = {
  key: string; cardId: string; currency: Currency; amountMinor: number;
  effectiveDate: string; recordedAt: string; evidenceIds: string[];
  issuerAllocations: { componentId: string; minor: number }[] | null;
};
export function recordPurchase(port: LedgerPort, input: PurchaseInput): Promise<PostResult>;
export function billInstallment(port: LedgerPort, input: BillingInput): Promise<PostResult>;
export function recordRepayment(port: LedgerPort, input: PaymentInput): Promise<PostResult>;
export function recordLinkedCredit(port: LedgerPort, input: {
  key: string; purchaseId: string; cardId: string; currency: Currency;
  amountMinor: number; effectiveDate: string; recordedAt: string;
  evidenceIds: string[]; billedReductionMinor: number; unbilledReductionMinor: number;
}): Promise<PostResult>;
```

- [ ] **Step 1:** Add `purchaseInput(overrides: Partial<PurchaseInput> = {}): PurchaseInput`, `billingInput(overrides?: Partial<BillingInput>): BillingInput`, `paymentInput(overrides?: Partial<PaymentInput>): PaymentInput` and `totals(port, cardId, currency): Promise<{ expenseMinor: number; billedMinor: number; unbilledMinor: number; clearingMinor: number }>` to synthetic test support. Defaults: 60000 purchase, 10000 first bill/payment, card-a/ARS, supported synthetic evidence; totals sum posted journal lines by account type/role, never source transaction totals.

```ts
import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { purchaseInput, billingInput, paymentInput, totals } from "./test-support";
import { recordPurchase, billInstallment, recordRepayment } from "./use-cases";
it("records 600 once; billing changes no total debt; payment reduces debt", async () => {
  const port = createMemoryLedger();
  await recordPurchase(port, purchaseInput());
  await billInstallment(port, billingInput());
  expect(await totals(port, "card-a", "ARS")).toMatchObject({
    expenseMinor: 60000, billedMinor: 10000, unbilledMinor: 50000,
  });
  await recordRepayment(port, paymentInput());
  expect(await totals(port, "card-a", "ARS")).toMatchObject({
    expenseMinor: 60000, billedMinor: 0, unbilledMinor: 50000, clearingMinor: -10000,
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/accounting/purchases.test.ts src/lib/accounting/attribution.test.ts`; expect missing exports/behavior before implementing.
- [ ] **Step 3:** Implement purchase posting: allocations must be positive exact minor units and sum to supported principal; ordinary consumption debits those accounts, credits the specific card/currency unbilled liability. Explicit asset/prepayment exceptions use their configured type; unknown financial nature returns a retained review result without a guessed posting. Seed Unallocated as an explicit expense account, not a hidden zero.
- [ ] **Step 4:** Implement billing: require an existing supported purchase/plan and stable installment identity, reject repeated billing with changed financial values into review, ensure cumulative principal billed cannot exceed supported principal. Debit unbilled and credit billed by exactly the supported installment amount; retain rounding residual only when source evidence establishes it.
- [ ] **Step 5:** Implement repayment: debit billed card liability and credit unresolved payment-source clearing, per Q9. Billed liability may become a debit/credit-in-favor balance when overpaid; purpose reports classify that portion as unapplied card credit. Do not reduce unbilled principal without evidence. Validate explicit issuer allocations; otherwise order eligible billed components by billed date, original purchase date, stable component ID, and assign deterministically. Opening debt keeps its unattributed purpose even when the convention reduces it. Persist attribution provenance and keep it revisable separately from the immutable repayment journal.

```ts
// Core of allocateOldestBilled after validating exact nonnegative input amounts.
let remaining = paymentMinor;
const assigned = components
  .slice().sort((a, b) => a.billedDate.localeCompare(b.billedDate)
    || a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id))
  .map(component => {
    const minor = Math.min(remaining, component.outstandingMinor);
    remaining -= minor;
    return { componentId: component.id, purposeId: component.purposeId, minor };
  }).filter(row => row.minor > 0);
// Return assigned plus unappliedMinor: remaining; never allocate to unbilled rows.
```

- [ ] **Step 6:** Implement linked credits on their own evidenced date, reversing original account/purpose allocations by a supported amount. Require the billed/unbilled reduction split to be supported and to sum to the credit; unsupported schedule effects remain reviewable. Interest/fees get separate `cost` journals only when their nature/amount is established; no forecast interest posting or inferred Plan Óvalo principal.
- [ ] **Step 7:** Add assertions for T09–T12/T16: six bills still one expense, overbilling, USD independence, unsafe amounts, 10000 Food + 20000 Travel with payment 15000 → 0/15000, explicit issuer allocation overriding FIFO, unallocated opening debt, overpayment credit and unchanged unbilled principal. Repeat one purchase/bill/payment input and assert no duplicate journal. Run memory and real-PG versions of the same financial cases.
- [ ] **Step 8:** Extend CLI demo to show the four-row Q8 example using these use cases. Run focused/full appropriate checks and checkpoint: `feat: connect purchases installments and card repayments`.

### Task 3: Original-period corrections, chart/groups and bilingual labels

**Files:** Create `web/src/lib/accounting/{corrections,catalog}.ts`, `corrections.test.ts`, `catalog.test.ts`, `migrations/003-corrections-catalog.sql`; extend use cases/adapters/CLI; modify `web/src/lib/i18n.ts` and `i18n.test.ts` only for new complete English/Spanish keys. Do not modify `AGENTS.md`.

**Interfaces:** Produce `correctPurchase(port, input: { key; cardId; purchaseId; expectedVersion: number; replacement: PurchaseInput; recordedAt: string; reason: string }): Promise<PostResult>` (string fields unless specified), `resolveLabel(account: Pick<Account, "customName" | "labelKey">, locale: Locale): string`, and `validateGroup(group: { id: string; customName: string | null; labelKey: string | null; accountIds: string[]; additive: boolean }): void`. Use `Locale`/translator only in the presentation/catalog label adapter, not journal rules. Add immutable purchase versions and correction links; old entries remain queryable.

Also produce `saveAccountName(port: LedgerPort, input: { key: string; accountId: string; customName: string | null; recordedAt: string }): Promise<{ accountId: string; customName: string | null }>` and `saveGroup(port: LedgerPort, input: { key: string; id: string; customName: string | null; labelKey: string | null; accountIds: string[]; additive: boolean; recordedAt: string }): Promise<{ groupId: string }>`. Add catalog read/append-revision operations to `LedgerTx` and implement them in both adapters. A null custom name restores a validated built-in label; it cannot leave a custom-only entity nameless. Start with flat custom collections plus the real account hierarchy; do not invent nested-group management requirements. Actual recorded times are provided by the server/operator clock, not copied from untrusted HTTP fields.

- [ ] **Step 1: Add the red correction/label tests.** `purchaseInput` now accepts the named allocations; the seeded chart includes Household supplies and its purpose ID.

```ts
import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { purchaseInput } from "./test-support";
import { recordPurchase, correctPurchase } from "./use-cases";
it("corrects January in January while recording the March action", async () => {
  const port = createMemoryLedger();
  const original = purchaseInput({ effectiveDate: "2026-01-15" });
  await recordPurchase(port, original);
  await correctPurchase(port, {
    key: "fix-1", cardId: "card-a", purchaseId: original.purchaseId, expectedVersion: 1,
    replacement: { ...original, allocations: [{ accountId: "expense:household", purposeId: "home", minor: 60000 }] },
    recordedAt: "2026-03-01T12:00:00Z", reason: "reviewed item evidence",
  });
  const journals = await port.journals("card-a");
  expect(journals.filter(j => j.kind === "reversal")[0]).toMatchObject({
    effectiveDate: "2026-01-15", recordedAt: "2026-03-01T12:00:00Z",
  });
  expect(journals.some(j => j.kind === "purchase")).toBe(true);
});
```

- [ ] **Step 2:** Run the correction/catalog test files; expect missing or wrong behavior.
- [ ] **Step 3:** Implement optimistic version check and one transaction that appends exact reversal plus corrected replacement and new purchase version. Pure classification corrections leave total debt unchanged. Corrections to principal/evidence that affect existing bills/payments must revalidate the whole affected chain; if inconsistent, retain the review and post no partial correction. Recompute Q31 analytical attributions from the earliest affected bill while preserving prior attribution revisions and original payment journals. No generic backdated deletion or current-date refund masquerading as correction.
- [ ] **Step 4:** Seed the agreed chart leaves from the proposal, seven grocery subaccounts, purpose groups, card-native subaccounts, Unallocated, opening equity and unresolved-source clearing. Use stable codes/IDs, explicit label keys and one optional custom name. Clearing's initial counterpart is an explicitly labeled unresolved-source asset role with possible credit balance, not income and not a fabricated bank. Show its signed balance separately rather than implying available cash. Account/type and parent-cycle validation run before persistence; unused speculative rent/investment accounts are not seeded merely for completeness.

```ts
// Presentation-only helper; account identity never comes from this string.
export function resolveLabel(account: Pick<Account, "customName" | "labelKey">, locale: Locale): string {
  if (account.customName !== null) return account.customName;
  if (account.labelKey === null) throw new Error("missing_account_label");
  return translator(locale)(account.labelKey as MessageKey);
}
```

- [ ] **Step 5:** Reject whitespace-only custom names at input; do not silently translate names. Add type-safe catalog-key validation at seed time so the cast above is only used after coverage validation. Test built-in names differ where translated, custom `Mi casa` stays exactly equal, duplicate labels do not merge IDs, group membership spans types but additive summaries use one primary purpose, and expenses are never added to debt as spending.
- [ ] **Step 6:** Add tests for stale simultaneous correction, changed amount after repayment, corrected purpose refreshing debt attribution, new April refund staying in April, unchanged rule/history unless explicitly requested, and original evidence/recorded-time retention. Run unit/PG checks and CLI audit output; checkpoint: `feat: preserve accounting corrections and account identity`.

### Task 4: Source revisions and conservative purchase identity

**Files:** Create `web/src/lib/accounting/evidence.ts`, `evidence.test.ts`, `migrations/004-evidence.sql`; extend port/adapters/test support/CLI. Read `web/src/lib/fingerprint.ts`, `ingest.ts`, `integrity.ts`, `receipts/charges.ts` before reusing helpers.

**Interfaces:** Produce `sourceKey(input: { cardId: string | null; kind: "statement" | "receipt"; documentHash: string; fiscalId: string | null; closingDate: string | null }): string`, `identifyPurchase(input: { cardId: string; currency: Currency; purchaseDate: string; voucher: string | null; installment: number | null; installmentCount: number | null; amountMinor: number; sourceLineId: string }, candidates: PurchaseIdentity[]): { status: "matched" | "new" | "review"; purchaseId: string | null; reason: string }`, where `PurchaseIdentity` has those same fields plus `purchaseId`. Produce `retainSource(port, input: SourceRevisionInput): Promise<{ revisionId: string; status: "new" | "duplicate" | "revision" }>`; `SourceRevisionInput` contains key, nullable cardId, kind, hash, portable object path, raw extracted payload, previous revision ID and recorded time. Receipt source identity is based on hash/chain-qualified fiscal ID independently of whether a card is known; statement cycle identity requires the actual card. Append only; stable line IDs include document revision and occurrence ordinal.

- [ ] **Step 1: Write the identity tests.** A match needs financial/document evidence; the test uses incomplete installment metadata deliberately.

```ts
import { expect, it } from "vitest";
import { identifyPurchase } from "./evidence";
it("does not collapse two equal same-day purchases without distinguishing evidence", () => {
  const line = { cardId: "a", currency: "ARS" as const, purchaseDate: "2026-01-15",
    voucher: null, installment: 2, installmentCount: 6, amountMinor: 10000, sourceLineId: "line-c" };
  const candidates = ["p1", "p2"].map((purchaseId, i) => ({ ...line,
    installment: 1, sourceLineId: `line-${i}`, purchaseId }));
  expect(identifyPurchase(line, candidates).status).toBe("review");
});
```

- [ ] **Step 2:** Run the focused evidence file, then implement card-qualified source identities. A brand is never the actual card key. Preserve original fingerprint/ordinal as legacy provenance; do not promote `(brand, closing_date)` or equal descriptor/amount into the new global identity.
- [ ] **Step 3:** Create immutable document revisions and line associations with uniqueness for hash/kind, fiscal identity where relevant and card-qualified statement cycles. A re-upload of the same bytes adds no new financial event. A changed cycle document creates a version linked to the prior one; conflicting facts enter reconciliation and accepted changes use Task 3 corrections.
- [ ] **Step 4:** Implement deterministic candidate evaluation: explicit issuer/voucher/card/currency evidence first; installment continuity and amounts are corroboration; multiple candidates, missing principal or conflicting totals remain reviewable. Do not infer original principal or prior repayments by multiplying `n/N` arithmetic. Store decision reason/code/parameters for later bilingual rendering.
- [ ] **Step 5:** Test two same-brand cards, different filenames for identical bytes, corrected cycle revisions, two genuine equal rows with occurrence ordinals, missing-history installment three, source reimport retaining link/review IDs, and missing source-object hash rejection. Validate a source revision plus its journal/command either commits together or leaves no posted partial result.
- [ ] **Step 6:** Run unit/PG tests and CLI revision inspection; default SQLite behavior must be unchanged. Checkpoint: `feat: retain source versions and explicit purchase identities`.

## Exit gate

- [ ] Tasks 1–4 focused and real-PG checks pass on synthetic data; CLI demonstrates posted/billed/paid/corrected views and source traceability.
- [ ] Existing app test/type/build checks still pass without PostgreSQL configured. No module import creates a pool or migrates storage.
- [ ] T06–T14/T16 have explicit assertions in the owned tests; evidence ambiguity is visible rather than forced into a ledger entry.
- [ ] Continue with [Tasks 5–8](2026-10-25-accounting-02-evidence.md) after preserving the verified diff. No live-data cutover is implied.
