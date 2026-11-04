# Private processing runtime and current installation

The supported runtime is the current private macOS installation with Apple Vision.
The user-approved local live cutover is complete; see the [cutover record](cutover-decision.md).
The benchmark records below precede that transition. No external OCR service, Linux
adapter, new application login, public tunnel or remote host purchase was added.

Observed on 2026-10-25: macOS 26.6.2 (25G83), arm64, repository virtual-environment
Python 3.13.1, pdfplumber 0.11.4 and pyobjc-framework-Vision 12.2.2.
The copied-document benchmark uses Node 20.20.2 with existing better-sqlite3
11.10.0, MuPDF 1.28.0, tsx 4.23.12 and esbuild 0.28.2. Imports of
pdfplumber, Vision, Quartz and Foundation succeeded in that interpreter. Resolve the
actual interpreter through `resolvePython()` (`TARJETAS_PYTHON`, otherwise the
repository `.venv/bin/python3`); a system Python is not a substitute.

MuPDF's installed Node/WASM renderer feeds the existing Apple Vision process. The
OCR script selects Spanish and English recognition characters independently of UI
locale, with language correction disabled to preserve product codes. Existing tall
page slicing, whole-page box coordinates and scale retries 3, 2 and 1.5 remain in
use. OCR runs sequentially in the benchmark; each existing child process has a
180-second timeout and 16 MiB output limit. Rendering uses the existing 40 MiB input
limit, but does not yet impose a separate raster-memory cap. This is a material
resource limit to measure before choosing a smaller hosted machine.

`validateRuntime()` probes explicitly configured canonical absolute document and
reference directories. Both must already exist, be separate, private (0700), and
writable. It creates/removes a private write probe. These checks cannot establish
persistence across provider replacement; mount/backup policy remains an operator
hosting decision. The runtime also runs configured parser/OCR script readability, bounded Python dependency probes and a
read-only `SELECT 1` against an explicit PostgreSQL URL. This readiness probe needs
`psql` on PATH; credentials are passed only through the child environment and no
URL/password/client diagnostic text is returned. Supported URL options currently
include `sslmode`; other options fail closed. Dependency presence is not receipt
accuracy, migration readiness or complete database integrity.

The later isolated local rehearsal uses an actual PostgreSQL 18.6 server and
18.6 clients from `/opt/homebrew/opt/postgresql@18/bin`, on loopback port 55433.
A fresh production readiness probe passed with this server, separate private
roots and the configured repository virtual-environment interpreter. Preserve the
virtual-environment executable path: resolving its executable symlink to the base
Python interpreter loses installed environment dependencies. No provider, recurring cost or production network exposure has
been selected. Keep the current private installation private. An actual remote
installation needs its concrete private access path, persistent mounts, supported
OCR runtime, budget and access configuration recorded before deployment.

## Reproduce copied-document processing

Restore a verified archive into a fresh isolated source root first. Pass the copied
receipt directory explicitly. The benchmark refuses the live repository `pdfs/`
tree and never opens the personal database. It creates an in-memory SQLite database
per input and a temporary private document directory, then removes the sandbox.
The copied input PDFs remain read-only. Do not point it at the only document copy.

```sh
cd web
# Use Node 20 for the existing native SQLite build.
# The entrypoint bundles local TS into temporary ESM using installed esbuild,
# keeping MuPDF/WASM and native SQLite external, then removes that executable.
npx tsx scripts/accounting-ocr-benchmark.ts \
  --receipt-dir "$ACCOUNTING_COPIED_RECEIPTS" --copied-source \
  --expected-dir src/lib/receipts/__fixtures__/expected \
  --output "$ACCOUNTING_PRIVATE_OCR_REPORT"
```

The report output is exclusively created with 0600 permissions and contains the
actual engine, content-hash fixture IDs, accepted/corrected flags, cents deltas,
durations and stable error codes. Console output contains counts only; receipt
text, filenames and dates are not logged. A nonzero exit indicates at least one
unresolved rejected input or setup failure. The raw report stays in ignored private
`qa-output/accounting-rehearsal/` storage.

Optional `--correction-dir "$ACCOUNTING_REVIEWED_CORRECTIONS"` uses explicitly
reviewed `<PDF SHA-256>.rows.txt` files only after a real OCR rejection. It calls the
same `ingestCorrected()` admission path, keeps both transcripts in the temporary
DB, and enforces the unchanged exact-cent gate. It does not invent a correction.
`accepted` means the first OCR admission succeeded; `correctionSucceeded` records a
subsequent successful correction. Both false means unresolved. If no rejection has
a supplied correction, that run supplies no real-OCR correction-success evidence.

With an expected directory, the benchmark additionally compares total, item count,
quantity, unit price, line total and discount totals by item position against
existing verified fixtures. Missing/mismatched expectations fail. This numeric
check complements the full existing acceptance suite's product descriptions,
SKU/EAN shape, discount tags and receipt associations; do not call it proof of all
those checks. Tall multi-page, accents, matching and correction behavior also need
representative fixture coverage, not only a successful engine import.

```sh
npx vitest run src/lib/accounting/runtime.test.ts \
  src/lib/receipts/ingest.test.ts src/lib/receipts/replay.test.ts \
  src/lib/receipts/pdf.test.ts
# Explicit copied acceptance PDFs, never the live default path:
TARJETAS_RECEIPT_ACCEPTANCE_DIR="$ACCOUNTING_COPIED_ACCEPTANCE_PDFS" \
  npm run test:receipts
npx tsc --noEmit
```

The focused offline tests passed 27 checks and TypeScript passed during this work.
They include retry/rejection/correction admission and replay verification without
external services. The real OCR results are recorded separately below. No tested fixture allows relaxing
one-cent reconciliation or accepting partial financial state after process failure.

Before deployment, run all supported issuer parsers and IPC/MEP updates against
copied fixtures and explicit isolated persistent reference storage; preserve their
network/provider configuration. Record actual versions, complete bilingual setup
and error behavior, host/storage/access decision, backup/recovery and UI checks.
Existing uploaded receipt data does not prove those operational dependencies work.

## Recorded copied-source result

On 2026-10-25, the verified restored source's 12 accepted receipt PDFs were replayed
through real MuPDF/Apple Vision ingestion on Node 20.20.2. Nine passed OCR admission;
three were rejected by the unchanged exact-cent gate (198,623 ms total processing).
Each rejected PDF hash matched a receipt with an already reviewed corrected
transcript in the copied database. The original copied PDF bytes, stored hash and
receipt/transcript identity were checked read-only before exporting those three
existing transcripts. No new text or financial facts were invented.

A separate real OCR rerun of those three PDFs still rejected their raw OCR, then
successfully admitted all three original reviewed corrections through
`ingestCorrected()` (63,163 ms total; all final deltas zero). Thus nine are OCR
admissions and three still require their existing manual corrections; there are no
unresolved cases in this copied corpus. This does not imply all 12 pass unattended
OCR. The first-pass and correction reports remain separate private artifacts in
ignored `qa-output/accounting-runtime/`.

The existing full real acceptance suite then passed all seven tests over the five
copied acceptance PDFs in 90.94 seconds. It checked the verified totals, item
positions/quantities/prices, descriptions, SKU/EAN shapes and discount tags without
relaxing its expectations. The 27 focused runtime/offline checks and TypeScript
also passed. The actual production readiness probe returned `{ok:true,errors:[]}`
with private temporary roots, the configured virtual environment and an explicit
connection to the isolated PostgreSQL 17 test server. These results establish this
private macOS processing path; remote hosting,
persistent production mounts, network exposure and the complete migration/UI gate
remain separate decisions and checks.


## Updated recovery/runtime checkpoint

The PostgreSQL 18 runtime probe result is retained privately in
`qa-output/accounting-recovery/runtime-pg18-correct-interpreter.json`. The earlier
PostgreSQL 17 results above remain historical observations. No OCR/parser engine,
receipt-admission implementation or accepted fixture changed in this checkpoint;
the existing copied-PDF real OCR and seven-test acceptance proofs remain applicable.
The full-ledger backup/restore proof is recorded in the backup runbook.

The validated host arrangement is the existing private macOS/Apple Vision runtime
with separate persistent private document and reference directories. A remote
provider, monthly budget, persistent-volume guarantees and concrete private remote
access path have not been selected. Thus local-runtime validation is complete;
remote hosting selection and deployment remain open. The application has no login:
any later remote installation must establish its private access restriction before
starting a listener accessible beyond that private installation.


PostgreSQL application startup now composes `validateRuntime()` from the actual
backend/database URL, `resolvePython()`, configured parser/OCR script paths and
`referenceDir()`. It requires explicit absolute `TARJETAS_DOCUMENT_ROOT` and
`TARJETAS_REFERENCE_DIR` values before probing, and stops startup with stable codes
if readiness fails. Default SQLite startup performs no accounting runtime probes.
The hook performs no migrations and does not open the legacy SQLite database.

## Concrete private runtime recommendation, 2026-10-25

Use the existing same-Mac installation as the compatible initial runtime: Node
20.20.2 from the configured fnm installation, repository `.venv/bin/python3`,
Apple Vision, MuPDF and PostgreSQL 18 on loopback. Keep access on that Mac and bind
application listeners to `127.0.0.1`; the local browser access path is the chosen
loopback port, with no remote forwarding or public listener. This recommendation
requires no provider purchase. It does not configure a service or switch the live
SQLite backend. A remote deployment remains a separate supported-runtime decision.

A fresh production `validateRuntime()` passed against the existing isolated frozen
candidate on PostgreSQL port 55433 with new, separate 0700 local directories
`qa-output/accounting-operations/documents` and `references`. Result:
`qa-output/accounting-operations/local-runtime-readiness.json`. The database probe
only executes `SELECT 1`; no candidate ledger was mutated. A sandbox-only
`database_unreachable` result was resolved by rerunning the same scoped probe with
local connection access. These empty directories prove private local read/write
readiness, not that candidate documents have been deployed there or that they
survive loss of the Mac. Keep the verified PostgreSQL/document archive and a
separate recovery copy before any live use.

The focused runtime, upload, reference-storage and atomic reference-publisher
checks passed 36 tests in four files. Existing real OCR evidence remains nine raw
admissions plus three successfully applied original reviewed corrections, and
seven real receipt acceptance tests. No unchanged expensive OCR run was repeated.

The actual parser command then replayed all 43 copied statement PDFs to an explicit
isolated output directory in 9.39 seconds, exit 0, covering Visa, Mastercard and
Mercado Pago. Every copied PDF hash stayed unchanged. The exact comparison against
existing copied parsed JSON is recorded in
`qa-output/accounting-operations/issuer-parser-replay.json`; raw private output is
retained alongside it. Thirty-seven match exactly; six differ only in the `file`
label because stored JSON retains an older filename alias. All 43 match in every
other field, with zero numeric/transaction differences. No live/default JSON
directory was used.

The unmodified IPC and MEP update commands also ran successfully with Node 20.20.2
into an explicit isolated `TARJETAS_REFERENCE_DIR`, using their existing public
provider endpoints and 30-second request timeout. IPC returned 32 months through
2026-08; MEP returned 34 months through 2026-10. Files were published with 0600
permissions. The first restricted DNS attempt failed; the same scoped public-data
requests succeeded with network access. No personal data/document was transmitted
and no live reference file changed. Versions, hashes, returned freshness and limits
are retained in `qa-output/accounting-operations/reference-command-replay.json`.
A successful command is not a guarantee that its provider supplies a newer month.

These concrete issuer/reference results close the missing operational command
replay. Full bilingual integrated writer/setup/error acceptance belongs to the
complete scenario matrix; readonly HTTP success alone does not establish it.

## Current live operator paths

The live Lerd site is `web`, rooted at this repository's `web/` directory, with its existing `web.test` / `gastos.test` aliases and port 43179. Private `.env.local` selects `tarjetas_accounting_live_20261025` on PostgreSQL18 at `127.0.0.1:55433`. Data paths are under `data/accounting/`: `postgres18/`, `documents/` and `references/`. Git ignores this private runtime/data tree.

Lerd's project proxy command is `../data/accounting/runtime/start-web.sh`. It starts only this installation's PostgreSQL cluster through `runtime/postgres18.sh start`, then runs the existing Node20 dev app. `postgres18.sh status|start|stop` provides explicit operator control. No operating-system launch agent was installed. A production webpack build was also verified; this local Lerd app retains its existing development-server lifecycle.

For a consistent live backup, use `lerd pause web` from `web/`, confirm port 43179 has no writer, run the accounting backup CLI with explicit PG connection/document/reference roots, verify its hash, then `lerd unpause web`. Do not stop PostgreSQL itself for a logical dump. The original stopped QA cluster remains preserved; do not start it concurrently on the same port.

Standalone reference-update commands must load the installation environment explicitly. From `web/`, with the recorded Node20 runtime:

```sh
node --env-file=.env.local --import tsx scripts/fetch-ipc.ts
node --env-file=.env.local --import tsx scripts/fetch-mep.ts
```

This selects the live private reference root; a bare shell does not automatically inherit Next's `.env.local` loading. Updates remain analytical and do not revalue immutable journals.
