# PostgreSQL accounting recovery

The `tarjetas-accounting-backup` version 1 format contains a custom PostgreSQL dump,
`objects/`, `pending/`, reference files, required object references, app/schema
metadata, and SHA-256/size records. The SQLite `tarjetas-backup` format remains
supported by `scripts/backup.py`; the two tools do not interchange formats.

This portable archive contains private unencrypted financial data. Store it privately
and copy it off the source machine. It contains neither credentials nor application
code. Managed snapshots/PITR, retention, and off-machine storage require a selected
host; this script does not configure them.

Stop the application, imports, corrections, and reference updates before creation.
Keep writers stopped until creation finishes. PostgreSQL's consistent dump cannot
make separately copied documents consistent while writers continue.

Use compatible PostgreSQL clients. The local rehearsal discovered PostgreSQL 18.4
clients under `/opt/homebrew/Cellar/libpq/18.4/bin`; resolve clients on the actual
execution machine and put that directory first in `PATH`. Configure PGHOST, PGPORT,
PGUSER, PGDATABASE and credentials through the process environment or PGPASSFILE.
Never put a DSN/password on the command line. This tool does not load `.env` files.
PGDATABASE must be a plain explicit database name.

The application schema must expose a read-only `accounting.accounting_backup_metadata` view
with one JSON `metadata` row containing `app_revision`, integer `schema_version`,
`database: {path: "database.dump", server_major: <major>}`, and unique
`source_references: ["objects/<relative path>"]`. These references must come from
persisted evidence records, never a directory listing. The tool fails closed if the
view is absent. The schema view includes admitted evidence plus retained legacy-object references.
The read-only application checker below supplies ledger and identity reconciliation.

Document storage consists of `objects/` and `pending/` beneath the explicit document
root. Reference storage is separate. Unknown top-level document entries, links and
special files are rejected to prevent silent omissions. Use canonical absolute
paths without symlink ancestors (on macOS use `/private/tmp`, rather than `/tmp`).

```sh
# Define these paths yourself; archive must be outside both source roots.
python3 scripts/accounting_backup.py create "$ACCOUNTING_ARCHIVE" \
  --document-root "$ACCOUNTING_DOCUMENT_ROOT" \
  --reference-root "$ACCOUNTING_REFERENCE_ROOT" --app-stopped
shasum -a 256 "$ACCOUNTING_ARCHIVE"
# Record this digest separately and set ACCOUNTING_ARCHIVE_SHA256 to that value.
python3 scripts/accounting_backup.py verify "$ACCOUNTING_ARCHIVE" --sha256 "$ACCOUNTING_ARCHIVE_SHA256"
```

Provision a new empty PostgreSQL database and two new empty roots. Set PGDATABASE
to that candidate database explicitly. Stop its writers. Restore never clears a
nonempty database and has no replacement/clean option.

```sh
python3 scripts/accounting_backup.py restore "$ACCOUNTING_ARCHIVE" \
  --document-root "$ACCOUNTING_RESTORE_DOCUMENT_ROOT" \
  --reference-root "$ACCOUNTING_RESTORE_REFERENCE_ROOT" --app-stopped \
  --sha256 "$ACCOUNTING_ARCHIVE_SHA256"
```

The archive is fully validated before any PostgreSQL process runs. Files are staged
and copied with private permissions before the transactional database restore.
After restore, required persisted reference identities and installed file hashes
are compared. The original archive/deployment is retained. A failed restore leaves
candidate files for diagnosis; the candidate must remain offline. Retry into another
new target. No switchover, migration, journal deletion or live-target rollback occurs.

Run the application-owned restore checker against this explicit candidate before
switching configuration. Verify migrations, per-currency balance, evidence hashes,
review/product/source counts, pending corrections, labels, receipt associations,
source clearing and Q31 components. Record archive SHA-256, app revision, server and
client versions, target database/root identities, checks and failures in a private
rehearsal report. The Python archive check alone does not prove those invariants.

```sh
python3 -m unittest discover -s scripts -p 'test_accounting_backup.py' -v
python3 -m unittest discover -s scripts -p 'test_backup.py' -v
# Disposable EMPTY source and target databases, created explicitly by the operator:
ACCOUNTING_PG_BACKUP_TESTS=1 \
  ACCOUNTING_PG_BACKUP_SOURCE="$ACCOUNTING_TEST_SOURCE_DB" \
  ACCOUNTING_PG_BACKUP_TARGET="$ACCOUNTING_TEST_TARGET_DB" \
  python3 -m unittest discover -s scripts -p 'test_accounting_backup.py' -v
```

The opt-in test performs a real dump/restore with synthetic rows and files. It
leaves synthetic database objects in both disposable databases for inspection and
fails if either was initially nonempty. It proves client/archive portability;
ledger-specific purchase/bill/payment/correction invariants require the separate
application test. Ordinary unit tests mock only PostgreSQL processes and exercise
real ZIP/checksum/path verification. No personal data is used.

## Recorded synthetic verification

On 2026-10-25 the explicit opt-in suite passed all 21 tests using an isolated
PostgreSQL 17 server and PostgreSQL 18.4 clients. The real case created a custom
dump, restored four synthetic event rows into a fresh database, checked relocated
source/pending/reference bytes, compared persisted required references, refused a
second restore into the nonempty target, and confirmed source rows remained intact.
The disposable databases retain their fixtures for inspection. This establishes
archive/client compatibility, not complete ledger recovery or cutover readiness.


## Full-schema recovery checker

`web/scripts/accounting-restore-test.ts` runs a repeatable-read, read-only PostgreSQL
transaction. It never migrates or repairs its explicit target. It validates the
installed migration versions; posted journal balances/evidence/posting accounts;
revision/correction/link chains; required enabled immutability triggers; and every
admitted and retained legacy object hash/size. Unreferenced object files fail too.
Its snapshot covers every accounting table's row count and deterministic full-row
SHA-256, every document/pending/reference file, trigger definitions, native account
and card/account balances (including unresolved payment-source clearing), and latest
component-revision totals. Thus product/review/receipt-link histories, custom labels,
Q31 components and retained provenance are reconciled even when aggregate balances
happen to match. This is recovery identity proof, not evidence that a historical
migration's proposed financial classifications have been approved.

While source writers remain stopped, create a private baseline; restore to a fresh
target, then compare it using exactly the same application revision:

```sh
cd web
# Environment URLs only; never put credentials into shell command arguments.
ACCOUNTING_RESTORE_DATABASE_URL="$ACCOUNTING_SOURCE_DATABASE_URL" \
  npx tsx scripts/accounting-restore-test.ts \
  --document-root "$ACCOUNTING_DOCUMENT_ROOT" \
  --reference-root "$ACCOUNTING_REFERENCE_ROOT" \
  --output "$ACCOUNTING_SOURCE_CHECK"
ACCOUNTING_RESTORE_DATABASE_URL="$ACCOUNTING_TARGET_DATABASE_URL" \
  npx tsx scripts/accounting-restore-test.ts \
  --document-root "$ACCOUNTING_RESTORE_DOCUMENT_ROOT" \
  --reference-root "$ACCOUNTING_RESTORE_REFERENCE_ROOT" \
  --baseline "$ACCOUNTING_SOURCE_CHECK" --output "$ACCOUNTING_TARGET_CHECK"
```

Outputs are exclusively created at 0600 and contain private identifiers/hashes; keep
them in ignored private rehearsal storage. A failed check returns nonzero and keeps
the target offline. Record an independently retained archive SHA-256 and supply
`--sha256` to verify/restore; a mismatch fails before directories or database writes.

On 2026-10-25 a full-schema PostgreSQL **18.6** roundtrip passed with posted purchase,
billing, repayment and reversal/replacement correction (five journals). It compared
every table/file and native balance after root relocation, checked actual immutable
journal/source-revision update rejection on the restored target, detected corrupted
object bytes, refused a wrong archive SHA before writes, refused a nonempty target,
and proved the source snapshot unchanged. This supplements the earlier PG17
synthetic-events test above. Reproduce in two explicitly provisioned **empty**
disposable databases; their fixture tables remain for inspection:

```sh
cd web
ACCOUNTING_PG_RECOVERY_TESTS=1 \
  ACCOUNTING_RECOVERY_SOURCE_URL="$ACCOUNTING_FRESH_TEST_SOURCE_URL" \
  ACCOUNTING_RECOVERY_TARGET_URL="$ACCOUNTING_FRESH_TEST_TARGET_URL" \
  npx vitest run src/lib/accounting/restore-check.test.ts
```

The Python focused suite now has 24 cases (the real synthetic-PG case requires its
separate opt-in), including failed `pg_dump`, failed restore, wrong external archive
SHA, missing/corrupt objects and retained source files. The original SQLite suite
still passes all 12 cases. Full copied-personal-data recovery results, if completed,
are recorded separately below and do not authorize cutover.


## Copied historical-data recovery result

The final frozen copied-data reconstruction was archived and restored into a fresh
isolated PostgreSQL 18.6 database and relocated private document/reference roots.
The source baseline, restored comparison and source-after comparison all passed:
53 accounting tables, 138 unique object identities, 2,071 posted journals, complete
retained-row provenance and reference-file bytes matched exactly. Archive validation
checked 142 payload files. The restored target produced no invariant errors and
the source remained unchanged. The independently recorded archive digest, target
identities, exact counts and reports are in ignored private
`qa-output/accounting-recovery/recovery-receipt.json`, with the archive and three
checker snapshots beside it. No active application configuration changed.

The final real integration test additionally supplied a manifest-valid archive
containing an invalid PostgreSQL dump. `pg_restore` failed, the fresh candidate
database remained empty, candidate files stayed available offline, and subsequent
restore from the untouched original archive succeeded into separate roots. All
14 runtime/startup/recovery tests passed with the PG recovery opt-in enabled.

Successful recovery preserves the reconstructed dataset; it does not approve its
historical financial conclusions. The historical reconstruction still contains
explicit unresolved reviews and remains incomplete for cutover. Keep its migration
report and decision gate separate from this successful backup/recovery result.

## Approved opening-cohort recovery result

A separate final approved-opening candidate was frozen and archived after the
operator-approved product-identity selection. It retained all 3,268 historical rows
and 55 canonical source revisions, posted four supported opening journals, and kept
203 product-item identities reviewed and 48 pending. Its disclosure report retained
all 66 outstanding identity/payment/link reviews. These states were independently
queried on both the source and restored target, with identical results.

The new PostgreSQL 18.6 archive restored into a fresh dedicated database and relocated
private roots. All 53 table identities/digests, 140 object identities, native account
and component totals, enabled guards, pending/review states and reference files
matched; all three source-before/restored/source-after checker reports had zero
errors. Archive validation checked 144 payload files. The source stayed unchanged.
The earlier historical cohort and its 2,071-journal archive were preserved separately.

Exact database/root identities, archive SHA-256, the approved/pending reconciliation
and three checker snapshots are recorded privately under
`qa-output/accounting-recovery/approved-opening/`, with `recovery-receipt.json` as the
entry point. This is the final approved-cohort recovery proof. The restored target
remains an isolated rehearsal: no live backend switch or deployment was performed.

## Frozen schema-12 recovery result

The later schema-12 cohort supersedes the earlier opening trial as the final
rehearsal candidate while preserving every earlier proof. Its immutable sources
carry the exact frozen runtime/build revision. The new archive restored into a
fresh dedicated PostgreSQL 18.6 database and relocated roots: 56 tables, 142 unique
objects and 146 archive payload files passed validation. Source-before, restored
and source-after snapshots matched exactly with zero errors.

The checker independently validates opening obligation proof identities and
validated foreign keys, original/already-billed/remaining arithmetic, allocation
conservation, capacity against the opening journal, actual future billings against
supported remainder, and native current remaining balances. Generic opening-balance
billings must reconcile to their opening journal and components and contain no
expense or income lines. A real synthetic roundtrip covers a generic billed opening
component plus partial later billing of an opening obligation without adding expense.

Independent final source/restored queries agreed on four opening journals, four
generic opening-billed components, four supported obligations totaling 21,488,022
ARS minor units, no later bills against those obligations, six current historical
receipt associations, 203 reviewed and 48 pending item identities, 3,268 retained
historical rows and 55 canonical sources. The actual frozen application reader
returned zero expense facts from generic opening billings and retained 1,005 known
historical acquisition observations. These observations do not invent historical
posted expense journals. The 60 disclosed reviews remain unresolved.

The supported unbilled amount is a receipt-evidenced subset at the issuer's actual
observation boundary; the remaining aggregate schedule amount is still unknown.
Neither recovery nor the source observations establish an October 25 unbilled balance
without later issuer evidence. Private reports, archive hash, state/projection proof
and runtime revision evidence are grouped under
`qa-output/accounting-recovery/final12/`. No live backend switch was performed.
