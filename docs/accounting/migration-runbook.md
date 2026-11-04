# Accounting migration rehearsal and release gate

The live SQLite writer remains authoritative. Reconstruction uses a read-only copy, fresh PostgreSQL targets and a separate private object directory. No live migration, deployment, destructive down migration or backend switch is authorized by a successful rehearsal.

## Recorded rehearsal

The supplied copy is `qa-output/accounting-rehearsal/source`. The original planning archive SHA-256 is `d3b58f87dd6cba53ff8870025dcaf64b1d52d06f1f4619855637c2dd4f14ba7f`; that archive was internally verified but did not have an enforced application-wide writer freeze. Its historical receipt does not establish a current cutover snapshot. The reconstruction independently hashes every file and every source row. The copied source digest for the recorded trial is `cbff8551aea1f52aacdefb5dbdf4527d16ef9bc9c030477b675193606420df3f`.

All 18 SQLite tables and 3,268 original rows are retained with source IDs, exact JSON payloads and hashes in `legacy_rows`; every copied file and the reviewed chart proposal are immutable hash objects referenced by `legacy_objects`. `legacy_id_map` connects original rows to canonical accounting entities. The private card registry explicitly lists statement filenames for each actual card identity. Display names and brands never serve as card identity keys.

Historical reconstruction imports canonical statement observations, conservative supported journals and actual receipt/product/review state. It preserves old chart rules as ordered disabled rules with their old classification in provenance. An unapplied chart proposal does not authorize promoting its candidate classifications. Uncertain purpose remains Unallocated; uncertain financial nature/principal/credit linkage receives review instead of a guessed posting.

The dedicated recovery source is local PostgreSQL 18 database `tarjetas_accounting_recovery_source`, schema `accounting`. The populated full-schema backup was restored into the fresh database `tarjetas_accounting_recovery_restored`, with all 53 tables and 138 document objects passing integrity checks. The recovery archive SHA-256 is `d816125e30fe79c57b2ec8e8cd5462fdd46b549299004b562268c08024631cd5`. Private proof lives in `qa-output/accounting-recovery/{full-source-before,full-source-after,full-restored}.json`; the original source before/after comparison is unchanged. These are rehearsal targets, not production selections.

Native report parity compares the actual PostgreSQL reader against original source observations, by source identity, period, section and currency. The recorded `historical-native-parity.json` has 111 native billed/credit/payment/charge/latest-schedule keys passing without any numerical exemptions. This does not establish complete historical economic purchase recognition or opening-debt reconstruction. The historical partial ledger has explicit issuer-balance residuals in `historical-final.json`. Missing history and unresolved principal are not explanations that waive those residuals.

An earlier approved opening trial is database `tarjetas_accounting_approved_candidate`, schema `accounting`, with private documents under `qa-output/accounting-rehearsal/approved-candidate`. Its separate full backup restored exactly into `tarjetas_accounting_approved_restored`: 53 tables, 140 objects, 144 archive payload files, with the source unchanged. Archive SHA-256: `06bdfbed74735d74e095262cddb4ea92224988ccd6366205b2919b7c6af4d5b7`. The private recovery receipt is `qa-output/accounting-recovery/approved-opening/recovery-receipt.json`. This cohort contains four supported opening journals, 203 explicitly reviewed historical item identities and 48 pending identities. Its report lists all 66 pending identity/payment/link records. Exact completed command replay returns an identical report and appends nothing. The earlier historical trial remains available separately.

Native billed/payment/charge/schedule parity passes 111 keys in this cohort, and all six card/native billed observations match the corresponding issuer date. The older Mercado Pago coverage date remains disclosed separately. Economic acquisition analytics must retain supported historical observations independently of opening-equity bookkeeping; opening mode does not authorize deleting those analytics or counting opening equity as spending. Unsupported installment principal and ambiguous financial nature remain reviewable. No live cutover has occurred.

The final frozen schema-12 candidate is `tarjetas_accounting_frozen_candidate`, schema `accounting`, with documents at `qa-output/accounting-rehearsal/frozen-candidate`. Its exact application revision is `worktree:c1f353c310b8b5244b3a2f834a98507d135213d7:01b09126dc56641ea9e074566a73644a0aba530877a4d0667f6c1ee79fb7e736`, recorded in all 55 canonical sources and checked against `qa-output/accounting-planning/code-freeze.json`. Journal/source recording time is the actual reconstruction-run timestamp; issuer effective dates and original association dates remain distinct.

The final archive restored exactly into `tarjetas_accounting_frozen_restored`: 56 tables, 142 objects and 146 archive payload files, with the source unchanged and zero integrity errors. Archive SHA-256: `bca5e394f5039f834b7c8d566d2d71f8998593ca9ac8b6a79f20281d8a8b0d72`. Private restore/checker evidence is under `qa-output/accounting-recovery/final12/`; exact source-to-restored state is recorded in `state-reconciliation.json`, and the restored reader proof is `reader-projection-proof.json`.

`frozen-candidate.json`, `frozen-candidate-replay.json` and `frozen-state-proof.json` record the final reconstruction, exact semantic replay and independent canonical-state checks. All 111 native billed/payment/charge/schedule keys pass without exemptions. All 1,005 known acquisition facts match their evidence: 1,000 supported one-off source purchases plus five verified full receipt costs, kept separate from billed installments and opening equity. All six original receipt associations are canonical, with no invented historical journals. The books have four opening journals, four generic purpose-null opening billed components and four receipt-supported unbilled obligation anchors; historical book expense remains zero.

The final cohort retains all 3,268 original rows, 203 reviewed receipt-item identities and 48 pending identities. Its 60 explicit pending identity/payment records remain visible. Supported future principal, the issuer future aggregate and the unsupported remainder are separately disclosed per actual card coverage date. Numeric parity and recovery pass; the report remains incomplete for unresolved policy/evidence and release gates. No live cutover has occurred.

## Reconstruct a new candidate

Run from `web`, using the configured Node 20 executable for `better-sqlite3`. Supply the PostgreSQL URL through the explicit test or staging environment variable, never a live/default URL. Keep credentials out of command histories and reports.

```sh
npm run accounting -- reconstruct --target staging \
  --source /absolute/private/source-copy \
  --documents /absolute/private/new-candidate/objects \
  --cards /absolute/private/card-registry.json \
  --mapping /absolute/private/proposal-review.json \
  --product-proposal /absolute/private/product-identity-review.json \
  --product-approvals /absolute/private/product-identity-approval.json \
  --cutoff 2026-10-01 --mode historical \
  --revision EXACT_APPLICATION_REVISION \
  --report /absolute/private/new-report.json
```

An omitted `--schema` selects a fresh random isolated schema. A dedicated fresh database can instead use `--schema accounting`, which is required by the production backup contract. Never clear an existing target. A target schema that already exists is accepted only as an exact completed replay with the same source/configuration digest; incomplete or different targets fail. Report files use exclusive creation. Replays do not append purchases, journals or operational history.

The optional product approval artifact must pin both the actual source snapshot digest and the exact proposal bytes. It lists individual original item IDs, reviewer, scope and exclusions. Reconstruction invokes the item review API only for those IDs and retains separate approval provenance. Exact arithmetic, an existing barcode or an old reviewed product flag alone does not approve printed-to-canonical identity. The current review approves 203 specific historical items, leaving 48 pending; it authorizes no account allocations or future matches.

Inspect `sourceCounts`, `retainedCounts`, per-table hashes, retained native totals, source-object verification, `operationalCounts`, individual unresolved IDs, native parity coverage and per-card issuer reconciliation. A count/hash success alone is insufficient. `complete` remains false until report parity and remaining policy/evidence requirements have actually been proven.

## Opening alternative and the Q4 decision

Rehearse `--mode opening` in another fresh target. Historical statement observations and receipt/product/history identities remain canonical and available to historical analytics; the observation-only import emits no historical purchase/payment/cost journals. Opening equity offsets the supported billed obligations at each issuer's actual coverage date. Coverage dates remain visible per card; an older issuer observation is never silently moved to a later common date.

Future issuer installment totals remain visible in the schedule/forecast layer. They are not automatically asserted to be principal and posted as unbilled debt. The API accepts separately evidenced opening principal with explicit source-object paths, native billed/unbilled amounts and an observation date; the isolated 100/300 partial-history test proves one 400 opening journal and zero fabricated expenses or repayments. Accepted future principal needs original supporting evidence; installment multiplication alone is insufficient.

Recommendation from the current trial: use a supported opening cohort with retained historical source analytics instead of claiming complete historical economic reconstruction. Before selecting the actual live mode/date, resolve or explicitly scope unsupported future principal, receipt/payment and classification reviews, financial-nature/credit reviews, per-card coverage boundaries and all release-gate failures. Later original-source discovery must use a reviewed correction/reconciliation, so it cannot duplicate the opening liability or historical expense.

## Supported opening principal and later billing

`--opening-proof /absolute/private/receipt-supported-unbilled.json` adds only the receipt-supported subset of future principal. Reconstruction verifies the exact copied database hash before/after, each referenced PDF/JSON hash, original receipt and transaction rows, printed JSON occurrence/voucher, actual card identity, the latest issuer date and actual observed installment boundaries. It derives remaining principal from the evidenced full receipt less actual observed bills, never from an assumed earlier installment or payment. The proof itself is retained as an immutable document object.

The current evidence supports four remaining receipt obligations at Mercado Pago's actual issuer coverage date. Their amounts, supported aggregate, issuer schedule aggregate and unsupported remainder are recorded separately in the private derived-opening proof and reconstruction report. A partial match does not mark the whole future schedule as principal or establish activity through a later global date; `completeFuturePrincipalKnown` remains false.

Opening equity offsets the supported billed and unbilled amounts together. The opening billed balance also has one explicit, purpose-null analytical component so later actual repayments can follow the disclosed oldest-billed-first rule without inventing earlier purchase/payment activity. This component is marked `opening_balance` and is not another billed-spending fact.

Migration 012 retains four immutable opening-obligation anchors tied to the actual opening journal and accepted receipt/statement evidence. Original principal, already observed bills, remaining principal and the actual installment boundary are kept separately. Only later supported bills transfer the recorded remainder from unbilled to billed debt; they create no new acquisition expense. Conflicting/ambiguous matches or unsupported credits remain reviewable. Initial purpose allocation stays Unallocated; product identity approval does not authorize account allocation.

## Historical receipt associations

Migration 010 adds canonical append-only `historical_receipt_associations`, separate from purchase-linked financial reconciliation. Each association anchors one accepted receipt revision to one accepted statement source line, with the actual card, original method/date/fingerprint, native amount corroboration and legacy-row provenance. Current associations follow the explicit link/unlink decision chain; earlier decisions remain immutable. A stale chain, conflicting command or source charge already owned by another receipt fails atomically through the normal ledger transaction and writer lock.

All six associations in the supplied source resolve to exactly one original transaction and one canonical source line. Their original receipt/charge association is preserved even when historical purchase principal is unknown or the selected opening mode deliberately creates no old purchase journals. The association attaches receipt navigation/details to the existing source-backed billing/acquisition fact; it creates no expense, principal, purchase, payment or extra report fact. For an installment receipt, the existing exact-cent/issuer-rounding comparison corroborates the association only; multiplication never authorizes recognizing financed principal.

A fingerprint that resolves to multiple source lines receives an explicit review containing candidate source-line IDs. Equal amounts, brands or names do not force a merge. The old SQLite table contains only the surviving links, so migration preserves each known original link decision and its timestamp; it does not invent an unknown earlier unlink history. Later link/unlink actions have a complete canonical audit chain.

## Release proof and authorization

```sh
npm run accounting -- release-check --target staging --proof /absolute/private/release-proof.json
```

The proof must contain every field of `ReleaseGateInput`, all P01–P27 and T01–T19 scenario IDs with passing results and concrete private artifacts, and parity/object/journal/bilingual/OCR/restore/cutover proof locations. Missing values fail. Each accepted numerical explanation must identify an accepted decision, exact report key, original coverage IDs and expected native delta. A blanket Q8/Q3 explanation cannot exempt a changed value. An unresolved record is disclosed individually and never removes a numerical difference from the gate.

Passing restore, native parity or automated tests individually does not authorize cutover. Present the actual final frozen archive hash, per-card coverage, chosen mode/date, exact unresolved IDs, host/storage/OCR result, restore proof and remaining scenario failures. Obtain the user's concrete authorization before changing the live backend/writer.

## Cutover and rollback record

After authorization, freeze application/import/reference writers, make and verify a fresh complete archive, reconstruct the final delta into a new candidate, recheck identities/native amounts/objects and the selected workflow smoke cases, then switch one backend configuration and resume one writer. Retain the original archive and candidate ledger.

Before any PostgreSQL live writes, rollback can restore the unchanged old backend after verifying the writer boundary. After PostgreSQL accepts writes, freeze both systems and preserve a new PG-plus-document backup. Export every command, source object, revision and decision since cutover, then reconcile into a verified recovery target. A SQLite flag flip is not a lossless rollback. Until a reverse transformation is proven, recover to compatible PostgreSQL or repair forward; never discard accepted purchases, receipts or edits to make an old snapshot run.

## Concrete decision packet

The [opening cohort and runtime decision packet](cutover-decision.md) records the
Q4 recommendation, actual per-card boundaries, private individual-review artifact,
exact frozen archive and rollback sequence. It keeps selection of an opening basis
separate from complete release proof and actual live-cutover authorization. No
historical source fact, unresolved amount or release criterion is waived.

## Executed local cutover — 2026-10-25

The user approved the live transition and the [cutover record](cutover-decision.md) now describes its completed execution. The actual writer is supervised by Lerd: pause/unpause the project site `web`, rather than killing its dev-server child, which is automatically restarted. The fresh writer-frozen SQLite archive, normalized source comparison, PostgreSQL restore, rollback rehearsal, exact live-fact checks, idempotent upload proof and post-live backup are recorded under `qa-output/accounting-cutover/20261025/`.

The live app uses private `web/.env.local` and persistent `data/accounting/` storage. All 60 approved pending work items remain; no source uncertainty was hidden to complete the cutover. The original planning/rehearsal records above remain dated evidence rather than assertions that the live app is still SQLite.
