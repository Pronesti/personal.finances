# Accounting Reconstruction and Cutover Implementation Plan

Execution status (2026-10-25): pre-cutover implementation and all 46 acceptance scenarios pass. See [current implementation status](../../accounting/implementation-status.md) and the acceptance matrix for evidence. The user-approved live cutover under Task 16 is now complete; current proof is linked from the implementation status. Original step checkboxes are retained as the planning specification.


> **Execution:** Follow the user-selected execution method and repository requirements. This plan does not require any additional skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove historical reconstruction, hosted processing and complete recovery before selecting a live accounting cutover.

**Architecture:** Rehearse from verified snapshots into isolated targets. Keep one application, one authoritative backend and one private document root per deployment; use explicit operator commands rather than a migration/replication service.

**Tech Stack:** Existing SQLite read-only API for discovery, PostgreSQL/`pg_dump`/`pg_restore`, Python standard library, existing MuPDF/OCR seam and app verification commands.

**Spec:** [Master plan and backup receipt](2026-10-25-accounting-architecture.md), [accepted requirements](../../accounting/requirements.md), [workflows](../../current-state/data-and-workflows.md), [P01–P27/T01–T19](../../current-state/preservation.md), [current backup guide](../../../BACKUP.md).

## Global Constraints

- **DO NOT IMPLEMENT** during planning. All following commands describe later authorized execution, not work performed for this delivery.
- Inherit master constraints; initial work uses a verified copy, never the only personal dataset.
- Preserve all evidence/history even if historical expense reconstruction cannot be completed. Missing prehistory uses supported opening obligations, not invented expenses or repayments.
- No application login initially; choose the actual network exposure/private installation before deployment. Do not silently enable public access or external document processing.
- No destructive down migration, dropping a live database, overwriting the only archive or discarding post-cutover writes.

## Review Focus

1. A copied database may reference documents outside its old absolute path — Tasks 13/15 verify content identity and relocation.
2. Historical installment three is not evidence of two earlier payments — Task 13.
3. A new OCR engine may produce plausible text with incorrect cents or product positions — Task 14.
4. A valid database dump with missing/corrupt source objects is not a complete backup — Task 15.
5. Switching back after new PG writes can lose real activity — Task 16 rehearses the freeze/export/reconcile path.

---

## File map and operator contracts

Create `web/src/lib/accounting/reconstruction.ts`, `reconstruction.test.ts`, `parity.ts`, `parity.test.ts`, `runtime.ts`, `runtime.test.ts`; extend `web/scripts/accounting.ts`. Create `scripts/accounting_backup.py`, `scripts/test_accounting_backup.py`, `web/scripts/accounting-restore-test.ts`, and `docs/accounting/{migration-runbook,hosting-runbook,backup-runbook}.md` during their owning implementation tasks. Change `BACKUP.md` only to explain both backup formats and exact operator selection; retain existing SQLite support.

No secrets or personal reports enter tracked fixtures/docs. Rehearsal source copies, reports and evidence maps live under ignored `qa-output/accounting-rehearsal/`. Runtime configuration contains the selected backend, explicit PG URL, private document root, persistent reference-data root, supported parser/OCR executables and external reference-data configuration; validate at startup without logging credentials. No new runtime, daemon, general task scheduler or generic storage-provider registry is required.

## Tasks

### Task 13: Isolated historical reconstruction and explanation of differences

**Files:** Create `accounting/reconstruction.ts`, `reconstruction.test.ts`, `parity.ts`, `parity.test.ts`; extend CLI; create migration runbook. Read every source schema in `db.ts`, import fixtures, current calculations, the account proposal and the private reviewed mapping artifact locally without uploading it.

**Interfaces:** Produce `reconstruct(input: { sourceRoot: string; targetUrl: string; cutoffDate: string; mode: "historical" | "opening" }): Promise<ReconstructionReport>`, where `ReconstructionReport` has `sourceCounts`, `retainedCounts`, `postedCounts`, `reviewCounts` as `Record<string, number>`, plus `missingObjects: string[]`, `ambiguousIds: string[]`, `unexplainedDifferences: { report: string; period: string; nativeMinor: number; reason: string }[]`, `approvedDifferences: { decision: string; report: string; reason: string }[]` and `complete: boolean`. Produce `compareParity(before: ReportSnapshot, after: ReportSnapshot, explanations: DifferenceExplanation[]): ParityResult`; `ReportSnapshot` is `{ values: Record<string, number | null>; coverage: Record<string, string[]> }`, `DifferenceExplanation` is `{ key: string; decision: string; reason: string }`, `ParityResult` is `{ unexplained: string[]; approved: string[] }`.

- [ ] **Step 1: Write the partial-history test** with an explicit fixture builder added to test support. `partialHistoryInput()` creates a temporary source tree with a 10000-cent third billed installment and issuer evidence supporting 30000 future principal, but no first/second payment evidence. It returns explicit test paths/URL and cutoff, never the live root.

```ts
import { expect, it } from "vitest";
import { partialHistoryInput, readReconstructedJournals } from "./test-support";
import { reconstruct } from "./reconstruction";
const pgIt = process.env.ACCOUNTING_PG_TESTS === "1" ? it : it.skip;
pgIt("opens supported 400 principal without inventing earlier expense or payments", async () => {
  const input = await partialHistoryInput();
  await reconstruct({ ...input, mode: "opening" });
  const journals = await readReconstructedJournals(input.targetUrl);
  expect(journals.some(j => j.kind === "purchase")).toBe(false);
  expect(journals.some(j => j.kind === "repayment")).toBe(false);
  const openings = journals.filter(j => j.kind === "opening");
  expect(openings).toHaveLength(1);
  expect(openings[0].lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(40000);
});
```

- [ ] **Step 2:** Add `readReconstructedJournals(targetUrl: string): Promise<Journal[]>` to test support; it reads the isolated ledger only. The fixture builder registers temporary-tree/schema/pool cleanup with Vitest `onTestFinished`. Extend `test:accounting:pg` to `ACCOUNTING_PG_TESTS=1 vitest run src/lib/accounting` so the explicitly opted-in reconstruction case runs too. All PG cases throw before setup when the requested test URL is absent; ordinary `npm test` skips these cases and still runs pure decision/parity tests. Factor the reconstruction row-to-command decision into `reconstruction.ts` as `openingFromEvidence(input: { billedMinor: number; unbilledMinor: number; evidenceIds: string[] }): { billedMinor: number; unbilledMinor: number; expenseMinor: 0 }` and unit-test 10000/30000 → 10000/30000/0 without PostgreSQL.
- [ ] **Step 3:** Restore a fresh verified archive into an empty rehearsal root using the existing backup CLI and its explicit `--root "$ACCOUNTING_REHEARSAL_ROOT" --app-stopped` flags; require that variable to name a fresh empty directory. Restore only to the new directory, without `--replace`. For cutover-quality evidence, pause source application/import/reference-data writes before taking that archive. Open the copied SQLite database with `Path.resolve().as_uri() + "?mode=ro"` in the Python discovery reader and `PRAGMA query_only=ON`; do not import `getDb()` or invoke its migrations.
- [ ] **Step 4:** Inventory all 18 source tables at the current revision and every manifest object. Retain source row IDs, rule order, aliases/proposals/rejections, alert/review history, receipts/items/discounts/transcripts, product codes/rules/matches, source associations and reference series. Add a legacy-ID map in PG. Preserve tentative old classifications as provenance; migrate to the new chart through reviewed mapping rules, leaving uncertain purpose Unallocated and uncertain financial nature in review.
- [ ] **Step 5:** Run historical reconstruction into a fresh target. Deduplicate purchases only with sufficient source evidence; reconcile statement-reported billed balances and future-principal coverage at the same boundary. If evidence cannot support a historical economic event, retain the source observation but do not fabricate its journal. In opening mode, offset supported initial billed/unbilled obligations with explicit opening equity on the chosen cutoff date; do not count that equity entry as spending. A later original source discovery must reconcile/correct rather than duplicate the opening obligation.
- [ ] **Step 6:** Produce count/identity/hash and native amount comparisons. Every source row/object must be retained or explicitly represented in a review/provenance record; aggregate report similarity alone cannot prove migration completeness. Test positive/negative purchases, USD refunds, duplicate equal rows, different same-brand cards, current/newer schedules, unresolved payment-source clearing and original/custom names.
- [ ] **Step 7:** Compare all report snapshots by period/basis/native currency with documented coverage and approved explanations. Add a parity test where one changed number is unexplained and fails; adding an explanation without an accepted decision ID must still fail. Each accepted explanation pins the affected fixture/report/period and expected delta; a blanket Q3 or Q8 string cannot exempt every difference. Accepted Q8 timing/recognition and Q2 card-identity differences are explainable; other legacy asymmetries remain unchanged or require an explicit scoped decision rather than automatic correction.
- [ ] **Step 8:** Write the private report and concrete cutover recommendation: historical reconstruction if supported, otherwise explicit supported opening balances plus retained historical source analytics. Present the evidence before choosing the final cutoff/date/mode. This is the planned Q4 decision gate; do not mark it settled while writing or executing an incomplete trial. Add the migration runbook with exact checked archive hash/target and rollback records.
- [ ] **Step 9:** Repeat against a second fresh target and compare stable identities/native totals; command replay does not double results. Run full relevant checks. Checkpoint `feat: rehearse accounting reconstruction with parity evidence`.

### Task 14: Hosted parser/OCR/storage proof before provider selection

**Files:** Create `accounting/runtime.ts`, `runtime.test.ts`, `web/scripts/accounting-ocr-benchmark.ts`, hosting runbook; modify `receipts/ocr.ts`, `receipts/pdf.ts`, `upload.ts` only as the chosen engine/process boundary requires. If a Linux OCR adapter is needed after evaluation, create `web/src/lib/receipts/tesseract.ts` and `tesseract.test.ts`; no adapter factory framework.

**Interfaces:** Produce `validateRuntime(input: { backend: "sqlite" | "postgres"; databaseUrl: string | undefined; documentRoot: string; parserExecutable: string; ocrExecutable: string | null }): { ok: boolean; errors: string[] }`. Reuse `ReceiptDeps.renderPages` and `ReceiptDeps.ocr`; any chosen engine must produce the existing `Box[]` contract or an explicitly tested adapter into it. Produce benchmark JSON `{ engine: string; fixtureId: string; accepted: boolean; correctionSucceeded: boolean; centsDelta: number | null; durationMs: number; errorCode: string | null }[]` without private text.

- [ ] **Step 1: Add the red runtime test.** The code rejects a PG mode lacking a connection and an unsafe/unwritable document root before accepting upload work.

```ts
import { expect, it } from "vitest";
import { validateRuntime } from "./runtime";
it("does not claim PG hosting is ready without its database configuration", () => {
  const result = validateRuntime({ backend: "postgres", databaseUrl: undefined,
    documentRoot: "/private/tmp/tarjetas-test-documents", parserExecutable: "python3", ocrExecutable: null });
  expect(result.ok).toBe(false);
  expect(result.errors).toContain("database_unconfigured");
});
```

- [ ] **Step 2:** Run runtime tests. Add narrow injected process/filesystem probes for tests; production probes verify the actual configured executable, writable persistent private document/reference storage and DB connectivity. Extend the input with `referenceRoot: string` here, updating the test and composition call together. Do not mistake an engine string or existence of old imported receipts for working hosted OCR.
- [ ] **Step 3:** Benchmark current Apple Vision on a compatible host and, only if a Linux deployment is being evaluated, local Tesseract as a candidate. The [official Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) documents language selection and TSV output; it does not establish receipt accuracy. Feed rendered image/TSV boxes through the existing rows/parser/verifier, with Spanish printed-source language independent of UI language. Preserve receipt scale retries and bounded process time/memory; use a simple subprocess and bounded concurrency before considering persistent workers.
- [ ] **Step 4:** Replay all current offline receipt fixtures and a private representative copied PDF set: accepted exact-cent totals, known rejection, correction/retry, tall multi-page receipts, accents, discount association and source coordinates. Record all regressions versus current engine, including whether manual correction still reaches the same exact gate. Do not relax cent checks to make the candidate pass.
- [ ] **Step 5:** Choose the simplest compatible private host and storage arrangement from this evidence. Prefer one persistent private document volume over introducing object storage if it satisfies actual deployment/backup requirements. Use a real object-store adapter only if the selected host needs it. The selected engine must pass supported workflow acceptance; if neither candidate passes, the hosted receipt workflow is blocked and needs another concrete private-runtime evaluation, not silent feature removal or external OCR permission assumptions.
- [ ] **Step 6:** Verify supported issuer parsers, Python dependencies, timeouts, MEP/IPC update commands, translated setup/errors, least required document-path access and chosen network exposure. No new app login is added. If setup is private-network access, document the exact access path; do not claim a public unauthenticated install was selected. Record host/engine/storage versions and private budget/runtime decision in the runbook without deploying during this planning task.
- [ ] **Step 7:** Run real OCR acceptance on the chosen runtime plus offline/unit/type/build checks. Test process failure returns stable localized codes and leaves no accepted partial financial state. Checkpoint `feat: verify hosted document processing runtime`.

### Task 15: PostgreSQL plus document backup and fresh-target restore

**Files:** Create `scripts/accounting_backup.py`, `scripts/test_accounting_backup.py`, `web/scripts/accounting-restore-test.ts`, backup runbook; modify `BACKUP.md` and backend/operator docs. Keep `scripts/backup.py` and its SQLite format working. No credential/source-code backup is silently added.

**Interfaces:** Python exports `create_backup(destination: Path, *, document_root: Path, reference_root: Path, database_env: dict[str, str], app_stopped: bool) -> dict`, `verify_backup(archive: Path) -> dict`, and `restore_backup(archive: Path, *, document_root: Path, reference_root: Path, database_env: dict[str, str], app_stopped: bool) -> dict`. A new versioned format includes `database.dump`, migration/app-version metadata, source objects, pending corrections, reference files, SHA-256/size manifest and required object-reference map. `database_env` contains validated PG connection environment fields; never print passwords/DSNs.

- [ ] **Step 1: Add the red unittest** using a temporary source tree and a mocked `subprocess.run` for unit tests. `backup_fixture(base: Path)` below defines the exact minimal format-v1 manifest and creates a fake dump/object/pending/reference set; the dump is synthetic only for unit verification tests. Real dump/restore compatibility belongs to Step 7. `tamper_member(path, name)` changes only the selected member.

```python
import hashlib, json, tempfile, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
import accounting_backup


def backup_fixture(base: Path) -> Path:
    files = {"database.dump": b"PGDMP-synthetic-unit-fixture",
             "objects/source.pdf": b"%PDF-synthetic",
             "pending/rows.txt": b"editable transcript",
             "references/ipc.json": b"{}"}
    manifest = {"format": "tarjetas-accounting-backup", "version": 1,
                "app_revision": "synthetic", "schema_version": 6,
                "database": {"path": "database.dump", "server_major": 18},
                "source_references": ["objects/source.pdf"],
                "files": {name: {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                          for name, data in files.items()}}
    archive = base / "backup.zip"
    with zipfile.ZipFile(archive, "x") as z:
        z.writestr("manifest.json", json.dumps(manifest))
        for name, data in files.items():
            z.writestr(name, data)
    return archive


def tamper_member(archive: Path, name: str) -> None:
    with zipfile.ZipFile(archive) as z:
        entries = {entry: z.read(entry) for entry in z.namelist()}
    entries[name] = b"damaged"
    with zipfile.ZipFile(archive, "w") as z:
        for entry, data in entries.items():
            z.writestr(entry, data)


class AccountingBackupTests(unittest.TestCase):
    def test_corrupt_object_is_rejected_before_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            archive = backup_fixture(base)
            tamper_member(archive, "objects/source.pdf")
            with patch("accounting_backup.subprocess.run") as runner:
                with self.assertRaisesRegex(accounting_backup.BackupError, "checksum"):
                    accounting_backup.restore_backup(archive, document_root=base / "new-docs",
                        reference_root=base / "new-references",
                        database_env={"PGDATABASE": "tarjetas_restore_test"}, app_stopped=True)
                runner.assert_not_called()
```

- [ ] **Step 2:** Run `python3 -m unittest discover -s scripts -p 'test_accounting_backup.py' -v`; expect missing module/behavior failure. Keep all fixture databases/trees temporary and mock process calls, not checksum verification.
- [ ] **Step 3:** Implement standard-library archive staging and exclusive destination creation. Require stopped application/import/reference writers for this first consistent DB-plus-files backup. Use compatible `pg_dump --format=custom --no-owner --file "$ACCOUNTING_DUMP_FILE"` with connection details passed in validated environment, not logs. Check exit status and stderr without echoing secrets. The [official dump documentation](https://www.postgresql.org/docs/18/app-pgdump.html) distinguishes database consistency from separately copied files; keep the writer-pause requirement. This portable archive complements rather than replaces the selected host's eventual managed backup/PITR arrangement.
- [ ] **Step 4:** Verify manifest schema, exact permitted entries, size/entry limits, no duplicate paths, no traversal/absolute paths/symlinks, all file sizes/hashes and required object references before restore. Reuse the existing backup's checked-path/hash functions where format-compatible instead of copying unsafe ZIP extraction code. New-format backup creation never overwrites an existing archive and preserves owner-only permissions.
- [ ] **Step 5:** Restore into a newly provisioned empty PostgreSQL target and fresh document/reference roots with the destination app stopped. Refuse a nonempty database/root rather than destructively clearing it. Keep the old deployment untouched and switch configuration only after validation. Use `pg_restore --exit-on-error --single-transaction --no-owner`; verify the [official restore flags](https://www.postgresql.org/docs/18/app-pgrestore.html) against the installed client. Stage documents first, restore DB, install/verify the new document root, then run invariant checks. A failed step leaves the original deployment untouched and marks the new target incomplete; never auto-switch it into service.
- [ ] **Step 6:** Implement `accounting-restore-test.ts`: verify migrations, per-currency journal balance, no orphan/missing objects, source revision and product/review counts, current receipt associations, pending corrections, custom labels, source-clearing balance and Q31 component totals. Query only the explicitly configured restore target. Relative object paths allow root relocation without rewriting financial evidence.
- [ ] **Step 7:** Add real PG round-trip tests under explicit `ACCOUNTING_PG_BACKUP_TESTS=1`: posted purchase/bill/payment/correction, byte-identical source objects, moved root, wrong archive hash, failed pg_dump, failed restore, missing object and refusal of a nonempty target. The opted-in suite fails when its isolated connection is unavailable; default Python tests need no running server. Assert a failed candidate restore never touches the source DB/root.
- [ ] **Step 8:** Run both backup test suites, real isolated round trip and operator CLI verify. Write exact create/verify/restore commands using named environment variables, empty-target requirements, app/client versions and recovery checks in the runbook. Checkpoint `feat: preserve portable accounting backup and recovery`.

### Task 16: Complete parity gate, concrete cutover and loss-aware rollback

**Files:** Extend `parity.ts`, `parity.test.ts`, `web/scripts/accounting.ts`, migration/hosting/backup runbooks; modify backend deployment selection only after the gate. Retain legacy source and snapshots through validation; unrelated old-code cleanup is not a cutover requirement.

**Interfaces:** Produce `releaseGate(input: { unexplainedDifferenceCount: number; missingObjectCount: number; unbalancedJournalCount: number; preservationScenariosPassed: number; targetScenariosPassed: number; bilingualChecksPassed: boolean; hostedOcrPassed: boolean; restorePassed: boolean; cutoverModeSelected: boolean }): { ready: boolean; failures: string[] }` and CLI `accounting release-check --target staging`. Pending review records are counted/disclosed; a transparent unresolved purchase is not the same as an unexplained discrepancy or silent data loss.

- [ ] **Step 1: Write the red release-gate test.** All checks except recovery are explicitly true, so a single failed restore cannot hide among general parity success.

```ts
import { expect, it } from "vitest";
import { releaseGate } from "./parity";
it("cannot cut over without a passing restore rehearsal", () => {
  const result = releaseGate({ unexplainedDifferenceCount: 0, missingObjectCount: 0,
    unbalancedJournalCount: 0, preservationScenariosPassed: 27, targetScenariosPassed: 19,
    bilingualChecksPassed: true, hostedOcrPassed: true, restorePassed: false, cutoverModeSelected: true });
  expect(result.ready).toBe(false);
  expect(result.failures).toContain("restore_not_proven");
});
```

- [ ] **Step 2:** Run parity tests and implement deterministic checks for every field; missing values fail, not default to success. The gate must list the failed scenario IDs and private report/artifact locations rather than only return a count. Add failures for one unexplained native difference, unbalanced journal, missing PDF, incomplete Spanish workflow and unselected cutover mode.
- [ ] **Step 3:** Execute P01–P27 and T01–T19 on the isolated selected backend. Validate all 33 features and 29 page paths, supported issuer uploads, rejected/corrected receipts, review scopes, forecasts/currency/terms, keyboard/mobile/light/dark, label collisions, unsaved language-switch drafts and restored data. Attach actual check results and approved numerical differences to the private report. Run full tests/type/build, explicit PG suite, OCR acceptance on selected runtime and both backup suites.
- [ ] **Step 4:** Present the concrete reconstruction/cutover report with selected date/mode, scoped unresolved records, final archive hash, target version, host/storage/OCR outcome, recovery proof and rollback steps. Obtain the user's actual cutover authorization before changing the live writer/backend. User acceptance of this plan is not a substitute for authorizing that concrete live migration.
- [ ] **Step 5:** Once authorized, pause all live writers, take/verify a fresh complete backup, apply the rehearsed final delta into the selected isolated candidate, rerun counts/hashes/native reconciliation and selected P/T smoke checks, and switch the single backend configuration. Resume one writer only. No dual writes or simultaneous old/new imports.
- [ ] **Step 6:** Rehearse rollback before resuming live writes: switching to the unchanged old snapshot is valid only while the new target has accepted no new financial activity. After new writes, freeze both systems, back up PG/documents, export every command/evidence/revision since the cutover boundary, and reconcile those records into a verified recovery target before switching. If a reverse transformation is not proven, keep the new dataset frozen and repair forward or restore to a compatible PG recovery target; do not improvise a lossy reverse migration. Never delete the candidate ledger or discard new receipts merely to make the old app start.
- [ ] **Step 7:** Confirm posted and billed views, issuer payment-source clearing, pending corrections, source navigation, product/review histories, both languages and backup creation on the active target. Retain old snapshots/deployment and the full private parity record until the user accepts recovery/retention completion. Propose any legacy-code removal as a separate scoped change after parity, not a condition for this migration.
- [ ] **Step 8:** Preserve the verified diff; checkpoint `feat: complete accounting migration readiness and cutover runbook`. Commit/PR/deployment actions follow the separately authorized workflow. Banks/transfers and cross-currency settlement remain the next release.

## Planning delivery versus future completion

The planning delivery includes the dated portable SQLite backup and its isolated restore verification recorded in the master plan. The PG backup tooling, reconstruction report, hosted engine, feature implementation and cutover checks above do not exist or pass merely because this plan describes them. Keep all their checkboxes unchecked until their actual evidence is recorded.
