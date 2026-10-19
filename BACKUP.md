# Back up and restore Tarjetas

Run these commands from the repository root with Python 3.9 or newer. They use only
the standard library; no app server, API key, or extra Python packages are needed.

## Create a backup

Pause uploads, corrections, categorization edits, and ingestion jobs while creating
a backup so the database and document trees describe the same application state.
The database snapshot itself is safe with SQLite WAL enabled and includes committed
WAL transactions. The script never migrates or rewrites the source database.

```sh
python3 scripts/backup.py create
# Or choose the output location explicitly (an existing archive is never overwritten):
python3 scripts/backup.py create /path/to/tarjetas-backup.zip
python3 scripts/backup.py verify /path/to/tarjetas-backup.zip
```

The default output is `backups/tarjetas-<UTC timestamp>-<unique suffix>.zip`, ignored
by Git. Every created archive is verified before the command reports success.
Copy it off this computer to protect against disk loss. Backups contain private
financial data and are **not encrypted**; use private storage or an encrypted drive.

The versioned ZIP includes:

- A complete standalone `data/app.db` SQLite snapshot: every table, row, ID, review
  decision, ordered rule, alias, product, transcript, and receipt/charge link present
  in the source database. The tooling does not depend on a particular schema version.
- All other `data/` files, including IPC/MEP series, seeds, and legacy JSON state.
- All statement PDFs, extracted JSON, and `.superseded` statement files.
- All receipt files, including `.pending` PDFs, editable OCR rows, and metadata.
- Empty directories and a manifest with byte sizes, SHA-256 checksums, and receipt
  path mappings. Each file is checked again during verification and restore.

The archive excludes the live database's WAL/SHM/journal sidecars (already included
in the snapshot), app code, dependencies, build output, and environment files such
as `web/.env.local`. Configure credentials separately on the destination. Browser
preferences such as localStorage are not server data and are not included.

## Restore locally or import into a hosted copy

Use the same application revision as the source, or a compatible newer revision.
A backup includes data, not application code. Stop the destination app and all
ingestion/background jobs before restoring, and keep them stopped until completion.

```sh
# An empty destination for an isolated check; --root is the repo root, not web/:
python3 scripts/backup.py restore /path/to/tarjetas-backup.zip \
  --root /path/to/destination/Tarjetas --app-stopped

# Replace an installation that already has data:
python3 scripts/backup.py restore /path/to/tarjetas-backup.zip \
  --root /path/to/destination/Tarjetas --app-stopped --replace
```

A fresh Git clone already contains tracked seed files and `.gitkeep` files, so use
`--replace` for that case too; those original directories are retained.

Restore validates the entire archive and database before changing destination data.
It stages the new directories, then installs them using directory renames. Ordinary
installation errors roll the completed renames back. With `--replace`, previous
directories are retained as `.tarjetas-before-restore-<id>-<name>` beside their
original locations; their exact paths are printed. Keep them until the restored app
has been checked. A process kill, power loss, or rollback disk failure can require
manual recovery from these retained directories; this is not a multi-disk transaction.
Restore replaces data rather than merging or deduplicating two installations.

Receipt `file_path` values are remapped to the destination receipt directory. Stale
paths left by moving the source checkout
are recovered from the configured receipt directory using the database's SHA-256
content identity, and the PDF bytes must match that hash. No
financial records or identifiers are otherwise changed. Restart the destination
app after restore, then check statements, receipts, pending corrections, and reviews.

For a hosted copy, transfer the ZIP and this script to the server, install the
compatible app revision, mount persistent writable storage for `data/`, `pdfs/`,
and `json/`, stop the app, then run the same restore command on that server as the
app's OS user. Reconfigure its API keys and runtime separately. Receipt OCR still
requires the platform/runtime used by that app feature; importing existing receipt
data does not provide an OCR service. A deployment with ephemeral local storage
cannot retain this SQLite/filesystem data across restarts.

## Custom storage paths

`--root` defaults to the repository containing this script. Both create and restore
honor `TARJETAS_PDF_DIR`, `TARJETAS_JSON_DIR`, and `TARJETAS_RECEIPT_DIR`. Export the
same values used by the app into the command's shell; this standalone script does
not load Next.js `.env` files. Relative override paths resolve from `<root>/web/`,
matching the application's working directory. `data/` always lives under `--root`.
The default receipt directory is `<root>/pdfs/receipts`, independently of the PDF
override, matching the app. Restore can use different overrides from the source.

Only the receipt directory may be nested inside the statement PDF directory; other
storage trees must be distinct. Symlinks and special files are rejected rather than
silently skipped. A missing database or a missing referenced receipt PDF fails the
backup. Archives are limited to 20 GiB of uncompressed files and 100,000 entries.
Checksums detect corruption; they do not authenticate an archive's author. Restore
only backups from a trusted source.

## Verification

```sh
python3 -m unittest discover -s scripts -p 'test_backup.py' -v
```

The tests use temporary databases and directories, covering committed WAL data,
complete round trips, configured storage, receipt path relocation, malformed archives,
tampering, replacement safety, and rollback after an installation failure.
