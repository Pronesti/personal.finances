# Accounting architecture and feature behavior

This describes the implemented migration architecture. See [implementation status](implementation-status.md) for acceptance and delivery state; the live installation has not switched merely because this document exists.

## One application, explicit storage selection

The existing Next.js application retains its routes, charts and local parsers. `TARJETAS_BACKEND` selects SQLite or PostgreSQL before page data or actions run. A PostgreSQL request does not fall back to SQLite. Framework-independent financial use cases run through a transaction port; PostgreSQL and memory adapters implement that port. PostgreSQL migrations run through the operator CLI, never implicitly during an upload.

PostgreSQL startup validates the configured database, private document/reference roots, parser and OCR runtime. The demonstrated private runtime uses PostgreSQL 18 and the existing macOS Vision pipeline. No public exposure or application login is introduced. A different hosting environment must pass the same runtime and receipt acceptance checks.

## Evidence, identity and financial events

Original PDFs, raw extraction JSON and transcripts are immutable content-addressed objects. Source revisions and ordered lines retain printed facts, actual card identity and review history. A brand is not a card identity. Revised evidence does not silently replace accepted financial facts.

Financial postings use exact integer minor units and balance independently in ARS and USD. A supported purchase recognizes its full known principal once. Installment billing moves liability from unbilled to billed; actual repayments reduce billed liability against unresolved payment-source clearing. Neither billing nor repayment creates another purchase expense. Linked refunds and financing costs are separate events. Unsupported principal, financial nature or credit linkage stays in review.

Posted corrections preserve the original entries and append reversal/replacement and audit records. Effective dates reflect the financial period; recorded timestamps reflect when the action actually occurred. Current reports use accepted corrected classifications without deleting the earlier decisions.

## Receipts and product identity

Receipt admission independently checks item gross totals, signed discounts and the paid total. Failed extraction retains pending evidence for corrected-transcript verification. Existing accepted PDFs are detected before OCR; a corrected receipt does not become a new rejection merely because its original OCR still fails.

Arithmetic verification does not approve canonical product identity. Price comparisons and account allocations require the relevant identity review. Raw item counts, promotions, signed discounts and receipt totals remain available even when a product match is pending. Product names, code ownership, units, merges and review history remain separate from printed evidence.

For a supported new purchase, receipt-first and statement-first workflows converge on one financial identity. Historical receipt associations can instead connect accepted receipt evidence to an actual issuer source line without inventing a posted purchase. Both paths check ownership and preserve link/unlink history. Associating a receipt never adds its total to spending a second time.

## Opening books and historical analytics

The source trial did not support a complete historical ledger. The opening approach records supported obligations at each issuer's actual evidence date rather than fabricating earlier expenses or payments. Earlier ordinary acquisitions and verified receipt-backed financed acquisitions remain labeled historical analytics outside the opening books. Unknown installment principal is not reconstructed by multiplying an installment.

Verified original receipts and actual observed billings can establish a supported remaining obligation. Immutable opening-obligation records retain that proof. A later actual installment reclassifies its supported remainder into billed debt without recording the original expense again. Unsupported cents and ambiguous matches require review.

The generic opening billed component remains unattributed. It participates in the disclosed oldest-billed-first analytical repayment convention before later billed components; only actual excess remains unapplied. Future issuer schedules remain forecasts, and unsupported future principal is visibly excluded from recorded debt.

Historical evidence classifications have a separate append-only review chain. Selected is the default scope; future rules and matching-history changes require explicit scope and confirmed affected identities. These source-only classifications do not alter the opening journals. Financial purchase corrections continue to use the financial correction path.

## Accounts, groups, reporting and language

The new chart uses stable account identities rather than copying the previous statement or product taxonomy. One primary purpose supports additive summaries. Optional custom groups can overlap and include expense and liability accounts; expenses, debt and repayments remain separate measures. Parent/child membership never counts an account twice within a group.

Built-in account and interface labels have English and Spanish translations. English remains the default; the `lang` cookie remembers a selection. Custom account/group names are one literal shared label. Names and translations do not identify or join records. Argentine source parsing and numeric conventions remain independent of interface language.

Report models read a consistent PostgreSQL snapshot. Purchase and as-billed bases stay distinct from actual payments. IPC and MEP restate reports, not journal currency. Monthly conversion precedes larger-period aggregation. Refresh commands use the selected persistent reference root and publish complete replacement tables atomically.

## Recovery and cutover

The PostgreSQL backup includes the database, immutable objects, pending evidence and reference series with an externally checked archive hash. Recovery requires a fresh database and empty private roots. Independent checks compare table identities/digests, native balances, immutable guards, source hashes, opening obligations and attribution conservation.

The original SQLite installation remains available during rehearsal. A live cutover requires a fresh writer freeze, verified complete backup, final source delta and release checks. After PostgreSQL accepts new activity, simply switching a flag back to an old SQLite snapshot is not a lossless rollback. See the [migration](migration-runbook.md) and [backup](backup-runbook.md) runbooks.


## Refunds linked to pre-opening acquisitions

A retained, accepted one-off statement purchase can support an explicitly confirmed full refund without creating a historical financial purchase entity. `historical-refunds.ts` validates the original/refund card, currency, exact amount and opening boundary, classifies the selected original purpose, and posts one current-period credit against billed liability. Its immutable `historical_refund` review decision links both source lines and the journal, prevents duplicate/excess full refunds, and closes only that refund’s review. The original acquisition remains in historical analytics; it is never re-posted as a new purchase. The reader includes this standalone credit exactly once and suppresses its duplicate issuer observation.
