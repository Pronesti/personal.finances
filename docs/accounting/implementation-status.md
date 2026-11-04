# Accounting migration implementation status

Recorded on 2026-10-25. **Implementation, all 46 acceptance scenarios and the user-approved live cutover are complete. The existing local app now uses PostgreSQL.** Changes remain local and uncommitted; no push, PR, merge or remote deployment has occurred.

## Approved plan coverage

| Plan | Current state |
| --- | --- |
| 01 — Ledger, Tasks 1–4 | Implemented and verified: balanced PostgreSQL journals, purchases, installment billing, repayments, linked credits, corrections, chart/groups and evidence identities. |
| 02 — Evidence, Tasks 5–8 | Implemented and verified: issuer import/replay/revisions, receipt rejection/correction, linking, scoped review, product/code ownership and merchant decisions. |
| 03 — Reports, Tasks 9–12 | Implemented and verified: all existing route adapters, report comparisons, account/group editing and English/Spanish interactions. |
| 04 — Operations, Tasks 13–15 | Reconstructed the copied source, verified the compatible private Mac runtime, and completed fresh-target backup/restore. |
| 04 — Task 16 | Completed: actual user authorization, managed writer freeze, fresh verified backup/delta, PostgreSQL restore, rollback rehearsal, backend switch, live bilingual checks and post-live backup. |

The [46-scenario acceptance matrix](acceptance-matrix.md) records every P01–P27 and T01–T19 obligation. Combined automated, database, filesystem, real-parser/OCR and browser evidence establishes the stated contracts. It does not claim that every invariant was reimplemented as a browser test.

## Final verified source and checks

Runtime digest: `8aadc8aed3b0aaff59de4b49089190cf7bc056a4948a8e1a17f8494d7442e8d7` across 254 pinned runtime/build files. The exact code archive is retained separately from the data archive. Private evidence: `qa-output/accounting-acceptance/release-code-freeze-r2.json` and `release-code-gates-r2.json`.

| Gate | Result |
| --- | --- |
| Default tests | 766 passed, 44 skipped; exit 0 |
| Accounting PostgreSQL tests | 290 passed, 2 skipped; exit 0 |
| TypeScript and production webpack build | Both exit 0 |
| Preservation / target acceptance | 27 / 19 passed |
| Strict release-check CLI | `ready: true`, no failures; root independently replayed it |
| Current producer backup and relocated restore | 56 tables, 142 objects, 146 payloads; exact restore, unchanged source, zero integrity errors |

Existing backup suites also passed: 12 SQLite cases and 23 PostgreSQL backup cases, with one opt-in skip. Actual PostgreSQL restores were executed separately. The issuer parser replayed all 43 copied PDFs with identical financial fields; six filename labels differed only. IPC/MEP commands wrote successfully into isolated private storage. Real receipt OCR/correction evidence includes the fresh browser rejection-to-correction journey with both original and corrected transcripts retained.

Browser acceptance covered report controls/drills, calendar-to-receipt navigation, selected/future/confirmed-history corrections, alert review/reopen and overview counts, product save/merge/code movement/rematch, receipt linking, custom names/groups, bilingual retained errors and mobile/appearance behavior. Controlled synthetic journeys visibly verified acquisition, billing, payment, original-period correction, distinct April refunds, 70/20/10 allocation, merchant merging and oldest-billed-first attribution in both languages. Synthetic data never entered the release candidate.

## Numerical preservation and deliberate differences

The copied-data audit retains 1,016 original comparisons: 668 direct passes and 348 intentional differences. Every changed comparison has exact source coverage, independent source proofs and individually pinned before/after values. Root replayed the pinned decision verifier: 11,542 numerical leaves, zero unexplained differences. This is not a blanket accounting-policy exemption.

Differences follow accepted rules: unsupported installment multiplication is not known acquisition principal; ambiguous car-plan financial nature stays in review; unlinked historical credits stay in billed/money-back/review evidence; only reviewed product identities enter trusted price analytics. All original amounts remain retained. The new producer and its restore bridge exactly to all 2,651 audit facts after documenting four configuration-derived opening-ID mappings; no financial or classification field changes.

Private proof: `full-report-comparison.json`, `accepted-report-differences.json`, `accepted-report-differences-verification.json`, `root-numerical-signoff.json` and `release-report-facts-bridge-r2.json`.

## Opening basis, reviews and recovery

The selected release-candidate basis is supported openings at each actual issuer date: Visa/Mastercard 2026-10-01 and Mercado Pago 2026-09-18. Historical acquisition analytics remain separate from opening-equity bookkeeping. This is not a complete common-date balance or complete historical reconstruction. Unknown future principal stays visible in forecast/review and is not invented as debt.

The candidate retains all 3,268 legacy rows, 55 canonical sources, 1,005 evidenced acquisitions, six canonical receipt associations, four opening journals and four supported opening obligations. Its 60 explicit unresolved records comprise 48 product identities, 11 receipt/payment cases and one multiple-candidate case. Product identity approval does not approve purpose allocations.

The reconstruction's original `complete: false` and `reportParityProven: false` flags remain intact because they describe the incomplete historical reconstruction. The separate, scoped opening-mode release proof passes; it does not relabel uncertain history as established.

Final data archive SHA-256: `7b650cbe012dba353acf94fdf5f48690ca55be7e5dac996dd38cf55ac4cb3f6f`. Recovery receipt: `qa-output/accounting-recovery/release-candidate-20261025-r2/recovery-receipt.json`. Verified data and producer-code copies are also in `/Users/diegopronesti/Downloads/Tarjetas-accounting-candidate-20261025-8aadc8ae/`.

## Completed live transition

The user explicitly approved the concrete opening basis and live switch. The live site remains the same Lerd-managed `web` application with `web.test` / `gastos.test` aliases and port 43179. Its private `.env.local` selects PostgreSQL, and its project startup wrapper starts the installation's PostgreSQL dependency first. PostgreSQL, documents and references now reside under ignored, private `data/accounting/` paths rather than QA storage. No new global startup service or remote host was installed.

Lerd's supervised app was paused before the fresh SQLite backup. All 18 tables and 3,268 rows matched the rehearsal after 12 verified receipt-path relocations; two newly prepared runtime operator files were retained as nonfinancial source additions. Fresh reconstruction, exact replay, backup and independent restore passed: **56 tables, 144 objects, 148 payloads**. The different object count reflects those two explicit runtime files, not missing or duplicate financial sources.

After resuming one PostgreSQL writer, all 2,651 facts, native balances, coverage, product decisions, receipt associations and 60 pending work items matched the approved baseline. English/Spanish pages and source PDFs passed actual browser checks. A real existing-statement upload returned HTTP 200 with `duplicate: true`, retaining four journals and 55 source revisions. SQLite main/WAL bytes remained unchanged. A second brief writer pause produced the verified post-live backup, then the app resumed successfully.

Current proof: `qa-output/accounting-cutover/20261025/cutover-complete.json` and `postcutover-verification/final-postcutover-verification.json`. Verified live recovery archives and private configuration are saved in `/Users/diegopronesti/Downloads/Tarjetas-live-cutover-20261025-8aadc8ae/`. Post-live archive SHA-256: `50b124d77f4e12439e07a15ff415c781140869e18fedc9408cb8234c7c3d0725`.

Before resuming the PostgreSQL writer, the frozen SQLite backup was also restored and booted in an isolated app; overview, taxes and receipts passed. The original SQLite data and older archives remain preserved. After PostgreSQL activity, recovery must retain/export/reconcile new commands and evidence; a flag flip to older SQLite is not lossless rollback.

The 60 identity/payment reviews disclosed at cutover and unknown future principal are data-review state, not unimplemented migration work. Before the October statement follow-up, source-based review and explicit user confirmations resolved 59 of the original 60 items and corrected one additional previously reviewed plant identity to Cyclamen eggs. At that stage, one original item remained: the September 18 receipt requiring opening-date reconciliation. The three rice/flour mismatches were corrected with audited per-line packaged-unit interpretations, preserving original evidence, quantities, amounts and catalog units. The package-size parser was fixed for new receipts; focused receipt/accounting tests, PostgreSQL regression tests, TypeScript and rendered checks passed. The September 18 purchase was left unposted and its review history was untouched by the unit correction; the later statement follow-up below resolves it. La Perla is confirmed bread; Palmolive is confirmed liquid body wash. Funding is the Mercado Pago card, with August 7 confirmed as a Visa-through-Mercado-Pago exception. Six historical association warnings were reviewed without duplicate postings. Five verified post-opening Mercado Pago receipts were recorded as unallocated acquisitions, totaling ARS 536,989.00; all five journals balance. Subsequent requested receipt-line allocation assigned all 99 lines across the five purchases (ARS 536,989.00), with zero left unallocated. Explicit user confirmation established Exquisita as cake mix, Natura as ketchup and the separate-barcode Cyclamen item as eggs. The final three lines were assigned to Pantry/snacks/baking and Dairy/eggs through audited corrections; source evidence, total expense, native debt and the September 18 source review are unchanged. The allocation audit is `qa-output/accounting-allocation-20261025/allocation-report.md`. Existing openings and original source data remain preserved. The private item-by-item inventory and audit are in `qa-output/accounting-review-20261025/review-items.md` and `user-confirmed-resolution.json`. Banks, transfers and cross-currency settlement remain the agreed next release. See the [cutover record](cutover-decision.md), [migration runbook](migration-runbook.md), [backup runbook](backup-runbook.md) and [hosting runbook](hosting-runbook.md).


## October statement follow-up — October 25, 2026

The supplied Mercado Pago October 18 statement was parsed, rehearsed against a restored copy and imported atomically. Its first September 18 Coto installment proves the receipt-backed ARS 117,188.60 principal was wholly unbilled at opening. An append-only opening supplement and obligation retain that principal once; October billing moves ARS 58,594.30 to billed debt and leaves ARS 58,594.30 unbilled. The receipt is linked to the statement and the last original migration review is closed: **all original 60 reviews are resolved**. Original opening journals and all five existing purchases/99 item allocations are preserved.

The new statement introduces two financial reviews: K9 Dog Trainers' pre-opening installment/principal and an unlinked ARS 287,500 TuEntrada refund. Consequently posted Mercado Pago billed debt (ARS 591,817.58) is not yet reconciled to the issuer's ARS 343,620.08 amount due; the ARS 248,197.50 gap is exactly those two retained, unposted amounts. Four new ordinary purchases totaling ARS 99,084.00 await account classification. No principal, bank source or refund income was guessed.

Importer follow-up fixes preserve item allocations/historical review state, recognize Mercado Pago's repayment wording and allow valid wholly unbilled opening obligations. The linked-installment display retains cents. Verification: 783 default tests passed (46 skipped), 13 focused PostgreSQL tests passed, TypeScript and browser checks passed; full operation rehearsed before live, all journals balanced, exact replay unchanged. Current audit and pre/post snapshots: `qa-output/accounting-october-statement-20261025/reconciliation-report.md`.


K9 purpose clarification (October 25): the user confirms K9 Dog Trainers is a dog-food seller. The selected September 8/October statement review now records `expense:pets:food`, purpose `pets`, superseding the training interpretation. The September and October statements both retain actual installments of ARS 39,302.50; the original purchase total and any embedded financing are not yet user-confirmed, so the financial review remains open. No financial entries or original source data changed. Audit: `qa-output/accounting-k9-20261025/purpose-confirmation.json`.


K9 principal confirmation (October 25): the user confirms ARS 78,605.00 in two interest-free installments. The selected pet-food purchase is now reconciled through an ARS 39,302.50 opening-unbilled supplement and the actual final October billing, leaving no K9 unbilled principal and no new expense. Its review is closed; the TuEntrada ARS 287,500 refund is the only open financial review. Posted Mercado Pago billed debt is ARS 631,120.08 versus the issuer’s ARS 343,620.08 due; their difference is exactly that pending refund. Four new purchases totaling ARS 99,084.00 still await classification. All 99 existing receipt allocations, source facts and purchase versions are preserved; all journals balance, and exact replay changes no records. Current evidence and snapshots: `qa-output/accounting-k9-20261025/status.md`.


## TuEntrada refund completion — October 25, 2026

The user explicitly authorized posting the full ARS 287,500 refund against the retained March 20 purchase. Its September 24 credit is now linked to both original/refund source lines, credited to Live events and tickets and debited against Mercado Pago billed debt. Original March evidence/history, purchase versions, repayments and all 99 receipt allocations remain intact. No old purchase or income was reconstructed. The refund review is closed: **zero open financial source reviews**.

Mercado Pago posted billed debt is **ARS 343,620.08**, exactly the October statement amount due, with **ARS 0.00 difference**. Unbilled principal is unchanged at ARS 376,324.24. The four newer ordinary purchases totaling ARS 99,084.00 still await expense-account classification; the agreed future bank phase will reconcile payment-source clearing.

A narrow full historical-refund use case and audit-kind migration 013 support this operation; the reader reports standalone credit journals once without duplicating issuer observations or losing ordinary credit corrections. Validation: 789 default tests passed (47 skipped), 23 focused PostgreSQL tests passed, TypeScript passed, real-data rehearsal and browser balance checks passed, all journals balanced, and exact replay changed no records. Current refund link, proof and pre/post backups: `qa-output/accounting-tuentrada-20261025/reconciliation-report.md`.


## Four new purchase classifications — completed October 25, 2026

The remaining ARS 99,084.00 is now fully classified: Grido ARS 20,100.00 → Restaurants/cafés/takeaway; Autores de Argentina ARS 27,000.00 → Books/stationery/learning materials (user confirmed book); AnimalsHouse ARS 28,125.00 → Pet food (user confirmed); MercadoLibre ARS 23,859.00 → Pet supplies/hygiene (user confirmed cat litter). These are selected-purchase corrections; no general marketplace/pet-store rule was inferred.

Current posted unallocated expense is **ARS 0.00**; there are **zero open financial source reviews**. Mercado Pago billed debt remains **ARS 343,620.08**, exactly October’s statement amount due. All native liabilities, total expense, original purchase dates/principal, source records, repayments and the 99 receipt allocations are preserved; all journals balance. Audit and pre/post snapshots: `qa-output/accounting-final-classification-20261025/classification-report.md`. Agreed bank/transfer/cross-currency work remains later scope; payment-source clearing has not been relabeled as a known bank account.
