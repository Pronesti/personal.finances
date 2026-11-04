# Accounting Evidence and Imports Implementation Plan

Execution status (2026-10-25): pre-cutover implementation and all 46 acceptance scenarios pass. See [current implementation status](../../accounting/implementation-status.md) and the acceptance matrix for evidence. The user-approved live cutover under Task 16 is now complete; current proof is linked from the implementation status. Original step checkboxes are retained as the planning specification.


> **Execution:** Follow the user-selected execution method and repository requirements. This plan does not require any additional skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import statements and receipts into one traceable purchase model while preserving extraction, correction, matching, products and review decisions.

**Architecture:** Keep document extraction outside accounting. Reuse the existing Python statement parsers, receipt parser/verifier and injectable `ReceiptDeps`; translate their outputs into evidence and domain commands, with atomic PostgreSQL persistence.

**Tech Stack:** Existing Python, MuPDF, TypeScript/Vitest/tsx, receipt OCR seam, and the PostgreSQL ledger from Tasks 1–4.

**Spec:** [Master plan](2026-10-25-accounting-architecture.md), [requirements](../../accounting/requirements.md), [workflows](../../current-state/data-and-workflows.md), [preservation](../../current-state/preservation.md), [chart proposal](../../proposals/personal-chart-of-accounts.md).

## Global Constraints

- **DO NOT IMPLEMENT** during planning. Inherit all master constraints; Tasks 1–4 must have passed before executing this plan.
- CLI and fixtures target a copy. The existing app remains the writer; do not add live dual writes.
- Preserve the 10 MiB statement limit, 40 MiB receipt limit, supported issuer detection, source bytes and exact-cent gate.
- Do not send documents to external OCR/AI. Optional sanitized merchant-name classification retains its current explicit boundary.
- Uncertain financial nature/identity/totals stay in review; uncertain purpose alone may use Unallocated.

## Review Focus

1. Renamed/revised statement imports preserve prior evidence, links and reviews — Task 5.
2. A cent mismatch rejects accounting admission while retaining editable pending evidence — Task 6.
3. Receipt-first and statement-first arrivals both create one purchase — Task 7.
4. Mathematically valid receipts with wrong canonical products cannot silently allocate by that product — Task 8.
5. Merchant broad-match changes must not silently rewrite all history, leak private text, or erase rejection state — Task 8.

---

## File map and shared inputs

Create `statement-import.ts`, `receipt-import.ts`, `review.ts` and their colocated tests under `web/src/lib/accounting/`. Add SQL migrations `005-source-facts.sql` and `006-reviews-products.sql`. Extend the existing `upload.ts` and `receipts/ingest.ts` only to expose extraction independently of their SQLite writer; retain legacy behavior/tests. Create `web/src/lib/accounting/documents.ts` only for the real filesystem boundary needed here, with an in-memory test implementation in test support.

Import reports use:

```ts
export type ImportResult = {
  sourceRevisionId: string; purchaseIds: string[];
  postedJournalIds: string[];
  reviews: { code: string; params: Record<string, string | number>; sourceLineIds: string[] }[];
  duplicate: boolean;
};
export type DocumentRef = { sha256: string; relativePath: string };
export type DocumentStore = {
  put(bytes: Buffer): Promise<DocumentRef>;
  read(ref: DocumentRef): Promise<Buffer>;
};
```

The persistent implementation uses one configured private document root and hash-named files. The in-memory test implementation stores bytes by hash. This is a meaningful I/O seam, not a new storage framework. Pending transcripts use their source hash and accepted/rejected revision records; preserve the original and correction independently.

## Tasks

### Task 5: Supported statement import without replacement/debt duplication

**Files:** Create `web/src/lib/accounting/statement-import.ts`, `statement-import.test.ts`, `documents.ts`, `migrations/005-source-facts.sql`; extend `web/src/lib/upload.ts`, ledger adapters/port and `web/scripts/accounting.ts`. Read `scripts/pdf_to_json.py`, `scripts/mp_statement.py`, `web/src/lib/{ingest,integrity,fingerprint,rules,aliases}.ts` and existing upload/ingest tests.

**Interfaces:** Produce `parseStatementUpload(bytes: Buffer, filename: string): Promise<{ json: StatementJson; rawJson: Buffer; pdf: Buffer }>` by extracting the existing checked parser path without changing its limits/timeout/errors. Produce `importStatement(port: LedgerPort, documents: DocumentStore, input: { key: string; cardId: string; filename: string; pdf: Buffer; json: StatementJson; rawJson: Buffer; recordedAt: string }): Promise<ImportResult>`. `StatementJson` is the existing integrity type, not a second parser contract. Add source-fact insertion and review-event operations to the same transaction boundary.

- [ ] **Step 1: Add the red test** using the existing sanitized statement fixture, passing an explicit card identity rather than inferring it from `brand`.

```ts
import { expect, it } from "vitest";
import { fixture } from "@/lib/__fixtures__/statement";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments } from "./test-support";
import { importStatement } from "./statement-import";
it("renamed identical uploads retain one source and no second posting", async () => {
  const port = createMemoryLedger(); const docs = createMemoryDocuments();
  const input = { key: "upload-a", cardId: "card-a", filename: fixture.file,
    pdf: Buffer.from("%PDF-synthetic-statement"), json: fixture, rawJson: Buffer.from(JSON.stringify(fixture)), recordedAt: "2026-08-01T12:00:00Z" };
  const first = await importStatement(port, docs, input);
  const again = await importStatement(port, docs, { ...input, key: "upload-b", filename: "renamed.pdf" });
  expect(again.sourceRevisionId).toBe(first.sourceRevisionId);
  expect(again.duplicate).toBe(true);
  expect(again.postedJournalIds).toEqual([]);
});
```

- [ ] **Step 2:** Define `createMemoryDocuments(): DocumentStore` in test support. Run the new test plus existing `upload.test.ts` and `ingest.test.ts` before changing their implementation. Expect only new behavior tests to fail.
- [ ] **Step 3:** Extract the parser seam. Keep filename/year handling, PDF magic, byte limits and 120-second process timeout. Legacy `ingestUpload` still calls `ingestFile` after parsing; it does not invoke PostgreSQL. The isolated CLI invokes `parseStatementUpload` and then `importStatement`. Do not hook an unfinished new backend into the live upload page yet.
- [ ] **Step 4:** Persist source revision, raw JSON and stable lines with all available cardholder/voucher/block/period/term metadata. Tables: `source_documents`, `source_revisions`, `source_lines`, `statement_cycles`, `statement_terms`, `issuer_schedules`, `review_events`. Preserve raw extracted JSON bytes as an object in addition to queryable JSONB so serialization does not replace original evidence. Add card-qualified cycle uniqueness and revision supersession, not a brand-global constraint.
- [ ] **Step 5:** Map supported lines into the Task 2 use cases within one import transaction. Purchases, billing events, actual payments, linked credits and identified costs remain distinct. Source balances and future aggregate schedules are evidence, not extra expense journals. Missing purchase principal/earlier history creates review or supported opening obligations during reconstruction; it does not cause a guessed full purchase. Conditional account rules come from approved new mappings, not a one-to-one reuse of old categories.
- [ ] **Step 6:** Make file/DB failure order explicit: write/hash immutable source objects first, then commit references and financial changes. A DB failure may leave unreferenced content; retries reuse that hash. Never delete source objects on rollback if another accepted revision might reference them. A missing/corrupt object prevents admission.
- [ ] **Step 7:** Add BBVA Visa/Mastercard and Mercado Pago parser fixture assertions; unknown layout, missing MP filename year, dual currencies, zero filler schedules, newest schedule per actual card, duplicate occurrence lines, same-brand different cards, conflicting same-key payload, concurrent import and corrected-cycle source supersession. Keep old source/alert decisions inspectable. Reimporting superseded JSON must not reactivate an old revision.
- [ ] **Step 8:** Run focused tests and PG import integration against a disposable target. CLI: `npm run accounting -- import-statement --target test --card card-a --input "$ACCOUNTING_REHEARSAL_JSON" --pdf "$ACCOUNTING_REHEARSAL_PDF"`; require both environment variables to name verified copied inputs and reject empty/missing paths before executing. These are operator-supplied file locations, never live defaults. Print structured counts/reviews, not raw private lines to remote logs. Run affected master checks; checkpoint `feat: import statement evidence into card accounting`.

### Task 6: Verified receipt admission and pending correction

**Files:** Create `web/src/lib/accounting/receipt-import.ts`, `receipt-import.test.ts`; extend document adapter, source schema and ledger adapters. Modify `web/src/lib/receipts/ingest.ts` to expose extraction while keeping the SQLite wrapper. Reuse `receipts/{pdf,ocr,rows,parse,verify,money}.ts`; do not replace their algorithms by name alone.

**Interfaces:** Produce `extractReceipt(bytes: Buffer, deps: ReceiptDeps): Promise<{ parsed: ParsedReceipt; rowsText: string; report: VerificationReport; scale: number }>` preserving existing `ReceiptRejected` payload on failure. Produce `importReceipt(port, documents, input: { key: string; bytes: Buffer; extraction: ReceiptExtraction; correctedRowsText: string | null; recordedAt: string }): Promise<ImportResult>`, where `ReceiptExtraction` is the exact return type just defined. Receipt admission stores evidence independently of whether its payment can yet be posted.

- [ ] **Step 1:** Add `receiptExtraction(overrides?: { totalCents?: number; productReviewed?: boolean }): ReceiptExtraction` to test support with a literal synthetic receipt: gross 10000, discount -2000, net 8000, valid date/fiscal ID and one item. Its default report comes from the real `verify` function; an override changes printed input and reruns that verifier, not a hardcoded `ok` flag.

```ts
import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments, receiptExtraction } from "./test-support";
import { importReceipt } from "./receipt-import";
it("keeps a cent-mismatched receipt out of accepted financial facts", async () => {
  const port = createMemoryLedger(); const documents = createMemoryDocuments();
  await expect(importReceipt(port, documents, {
    key: "receipt-bad", bytes: Buffer.from("%PDF-synthetic-receipt"),
    extraction: receiptExtraction({ totalCents: 8001 }), correctedRowsText: null,
    recordedAt: "2026-01-15T12:00:00Z",
  })).rejects.toMatchObject({ code: "verification_failed" });
  expect(await port.journals("card-a")).toEqual([]);
});
```

- [ ] **Step 2:** Run receipt-import and existing verify/replay/ingest tests. Preserve the rejection payload shape at the HTTP boundary even if the internal new import uses a structured `verification_failed` error.
- [ ] **Step 3:** Separate extraction from storage without bypassing the three exact checks: item gross equals subtotal; signed discounts equal printed discounts; subtotal plus discounts equals paid total. Reuse integer cents/quantity-thousandths. Preserve multiplications/offer-summary differences as warnings where current behavior does so.
- [ ] **Step 4:** Persist rejected attempts by hash with PDF, rows, verification details, scale and recording time. A corrected transcript must run the same gate, preserve original OCR and accepted correction, then create accepted receipt evidence exactly once. Store fiscal metadata, payment metadata, all line order/descriptions/codes/quantities/units/prices and every signed discount. PDF hash and fiscal identity duplicate checks remain separate.
- [ ] **Step 5:** Implement pending-source recovery after a process/file failure: an immutable source object can be reused; a failed financial transaction cannot leave an accepted purchase. Enforce private-root path traversal checks, generated object names, no symlink escape and existing byte limits. Do not equate a mathematically verified receipt with reviewed product identity or known payment source.
- [ ] **Step 6:** Test a valid 8000 receipt, rejected 8001, corrected retry, duplicate bytes/different filename, duplicate fiscal ID/different bytes, OCR unavailable, three scales exhausted retaining best failed attempt, original/corrected transcripts and imported-only receipts without OCR. Real OCR is a separate opt-in check; unit tests inject `ReceiptDeps` and use offline replay.
- [ ] **Step 7:** Run unit/PG checks and a CLI receipt import/correct round trip on synthetic/copied data. Checkpoint `feat: preserve verified and pending receipt evidence`.

### Task 7: Receipt-first matching and same-purchase allocations

**Files:** Extend `evidence.ts`, `receipt-import.ts`, `statement-import.ts`, adapters and migrations; create `receipt-linking.test.ts`. Read current `receipts/charges.ts` and its tests for candidate windows and occupied-charge rules.

**Interfaces:** Produce `reconcileReceipt(port, input: { key: string; receiptRevisionId: string; cardId: string | null; paymentVerified: boolean; purchaseId: string | null; allocation: { accountId: string; purposeId: string; minor: number }[] | null; recordedAt: string }): Promise<ImportResult>` and `unlinkReceipt(port, input: { key: string; receiptRevisionId: string; recordedAt: string }): Promise<void>`. Automatic matching uses the same explicit decision records as manual matching. The receipt/charge association is not the purchase identity or another financial event.

- [ ] **Step 1:** Add test-support `receiptThenStatement(port, documents): Promise<ImportResult[]>` that calls the actual import/reconcile functions with a verified synthetic 12000-cent receipt, explicit card-a payment proof, and one later 12000 statement line. No mock may simply return the desired number of purchases.

```ts
import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { createMemoryDocuments, receiptThenStatement, totals } from "./test-support";
it("receipt-first creates one supported purchase, later statement only confirms billing", async () => {
  const port = createMemoryLedger();
  await receiptThenStatement(port, createMemoryDocuments());
  expect(await totals(port, "card-a", "ARS")).toMatchObject({ expenseMinor: 12000 });
  expect((await port.journals("card-a")).filter(j => j.kind === "purchase")).toHaveLength(1);
});
```

- [ ] **Step 2:** Run the new file, then implement Q30: require supported acquisition, amount, payment method and specific card before receipt-originated posting. Missing card/payment facts retain receipt analytics but leave proposed accounting in review. Do not derive an installment plan from receipt total alone.
- [ ] **Step 3:** For statement-first arrivals, link verified evidence to the existing purchase; for receipt-first arrivals, reuse purchase identity and append the evidenced billing transition. Exact single candidate can auto-link, ambiguity requires human review, occupied matches are refused, and discrepancy retains both amounts. Use current three-day/rounding candidate checks as corroboration; match tolerance never authorizes altering source cents or blindly merging two purchases.
- [ ] **Step 4:** Apply reviewed item allocations to the same purchase, sum exactly to principal and use Task 3 classification corrections if already posted. A domestic supermarket without detail stays Unallocated. Travel overrides follow evidence of purchase abroad and exclude online subscriptions; receipt detail remains available even when the purpose is Travel.
- [ ] **Step 5:** Unlinking removes/revises the evidence association only. It does not delete purchase debt, reverse a real acquisition or erase the receipt. If earlier wrong matching affected allocation, require an explicit corrective command rather than silently undoing journals.
- [ ] **Step 5a:** Pin the existing reimport behavior: an explicitly unlinked receipt may auto-link again on a later import if the same candidate is uniquely eligible. Do not introduce a durable ignore/suppression rule unless separately requested; do retain the unlink/relink decision history.
- [ ] **Step 6:** Test both arrival orders, two candidate cards, one-cent discrepancy, duplicate receipts, already-occupied charge, unlink/relink, receipt allocation 7000/2000/1000, installment receipt attached across cycles, insufficient payment metadata and unsupported split-payment cases. Keep split/multiple-receipt evidence reviewable; do not add bank payment workflows to resolve them.
- [ ] **Step 7:** Run unit/PG matching tests and inspect the CLI review output. Checkpoint `feat: reconcile receipts with one economic purchase`.

### Task 8: Merchant, product and investigation decisions retain scope/history

**Files:** Create `web/src/lib/accounting/review.ts`, `review.test.ts`, `migrations/006-reviews-products.sql`; extend adapters; read existing `rules.ts`, `aliases.ts`, `queries.ts` review functions, `receipts/{products,match}.ts`, `llm.ts` and action files. Existing action wiring is moved only in Task 9/12 when the matching read path is ready.

**Interfaces:** Produce `classifyPurchase(port, input: { key: string; cardId: string; purchaseId: string; accountId: string; purposeId: string; scope: "selected" | "future_rule" | "matching_history"; match: string | null; recordedAt: string }): Promise<{ affectedPurchaseIds: string[]; ruleId: string | null }>`. Produce `applyReview(port, input: { key: string; subjectId: string; kind: "product_update" | "product_merge" | "move_code" | "merchant_merge" | "alert_state" | "proposal_accept" | "proposal_reject"; payload: Record<string, unknown>; recordedAt: string }): Promise<{ decisionId: string; affectedIds: string[] }>`; validate the payload per kind in this task before using it, never passing untrusted records into SQL.

| Review kind | Required validated payload and failure condition |
| --- | --- |
| `product_update` | Existing product ID; nonblank name; known product-category ID and unit `un`/`kg`; reject unknown IDs/units |
| `product_merge` | Distinct existing source/target product IDs; reject self-merge or lost code ownership |
| `move_code` | Existing chain/SKU and target product ID; preserve printed item codes and previous ownership revision |
| `merchant_merge` | Existing normalized source name and nonblank target name; reject alias cycles and preview affected families |
| `alert_state` | Existing stable alert subject and `open`/`reviewed`/`dismissed`; append the decision rather than deleting prior state |
| `proposal_accept` | Existing proposal ID, explicit match text, account/purpose IDs and selected/future/history scope; reject conflicts with owned rules |
| `proposal_reject` | Existing proposal ID and sanitized merchant identity; persist rejection so regeneration does not silently recreate it |

The write port gains `reviewSubject(kind: string, subjectId: string): Promise<ReviewSubject | null>` and `appendReview(decision: ReviewDecision): Promise<void>` here. `ReviewSubject` is a discriminated union of the existing product/code/merchant/alert/proposal records above; `ReviewDecision` contains its stable ID, command key, subject ID, kind, validated payload, prior decision ID and actual recorded time. Both adapters implement this same contract. UI timestamps come from the server clock, not untrusted form fields.

- [ ] **Step 1:** Define `seedTwoPurchases(port): Promise<void>` in test support by recording two genuine purchases from the same merchant, each with distinct IDs/keys. Add the test:

```ts
import { expect, it } from "vitest";
import { createMemoryLedger } from "./memory";
import { seedTwoPurchases } from "./test-support";
import { classifyPurchase } from "./review";
it("selected correction does not silently rewrite its merchant family", async () => {
  const port = createMemoryLedger(); await seedTwoPurchases(port);
  const result = await classifyPurchase(port, { key: "classify-p1", cardId: "card-a",
    purchaseId: "p1", accountId: "expense:household", purposeId: "home",
    scope: "selected", match: null, recordedAt: "2026-03-01T12:00:00Z" });
  expect(result.affectedPurchaseIds).toEqual(["p1"]);
  expect(result.ruleId).toBeNull();
});
```

- [ ] **Step 2:** Run the new review file and relevant existing rules/aliases/products/match/LLM tests. Implement ordered accepted rules, explicit preview/confirmation for matching-history effects, separate future-rule changes and immutable classification revisions. Bulk correction remains available explicitly; source text never changes because an alias or rule changes.
- [ ] **Step 3:** Migrate product IDs, code ownership, units, rules/matches and provenance; preserve renamed and merged identities with redirect/history records. A code move affects the selected code's mapping without rewriting its printed evidence. Wrong canonical matches remain flagged; cent reconciliation alone never approves account allocation or product price comparisons. Do not apply the private proposal's tentative mappings as confirmed facts.
- [ ] **Step 4:** Retain alert decisions with stable subject identity and all state transitions (`open`, `reviewed`, `dismissed`, reopen). Vanished/resolved source alerts leave retained history; reimport does not erase it. Merchant aliases rederive from source descriptions, respecting explicit accepted categories and future/history scope.
- [ ] **Step 5:** Reuse optional merchant-name classifier only for the current sanitized name payload. Preserve human acceptance, proposal evidence, rejection persistence and explicit error states. Neither receipt text, account notes, PDFs nor full transaction records cross that boundary. Add a request-payload assertion to the LLM test; do not call the API during tests.
- [ ] **Step 6:** Test product merge/move-code/rematch, incorrect product identity, preserved source evidence, family preview, future-only versus selected/history scopes, Travel evidence versus USD online subscription, linked original-account credit, Sancor car insurance, car-payment financial ambiguity and alert reopen after replacement. Test validation failures produce zero partial financial writes.
- [ ] **Step 7:** Run focused/full relevant tests and PG integration; checkpoint `feat: retain scoped classification and review decisions`.

## Exit gate

- [ ] CLI imports cover P01/P02/P06/P07/P19/P20/P23/P24/P25 and T01–T15 on isolated fixtures with source evidence inspectable.
- [ ] No live UI path writes PostgreSQL while its matching view silently reads SQLite. Legacy app behavior is preserved until the next plan connects a complete backend mode.
- [ ] Continue with [Tasks 9–12](2026-10-25-accounting-03-reports.md). A functioning hosted OCR installation is still a separate Task 14 gate.
