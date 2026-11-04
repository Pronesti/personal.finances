# Executed opening basis and live cutover

The user approved the concrete live switch on 2026-10-25. The existing local Lerd application now uses PostgreSQL. All 46 acceptance scenarios and the strict release gate passed before the transition; fresh-source reconciliation, independent restore, rollback rehearsal and actual post-cutover verification also passed. No commit, push or remote deployment occurred.

The approved opening basis uses Visa/Mastercard observations dated 2026-10-01 and Mercado Pago dated 2026-09-18. These are separate actual issuer boundaries, not a complete common-date balance. Historical acquisition analytics remain separate from opening-equity bookkeeping. Supported billed balances and four receipt-backed unbilled obligations are retained; unsupported future principal remains forecast/review evidence rather than invented debt.

The live dataset retains all 3,268 legacy rows, 55 canonical sources, 1,005 supported historical acquisitions and six receipt associations. The approved 60 pending work items remain explicit: 48 product identities, 11 receipt/payment cases and one multiple-candidate case. Accepting the opening basis does not approve those individual cases, infer financial components of the car plan, or turn product identity approval into purpose allocation approval.

The live PostgreSQL cluster is under private `data/accounting/postgres18`, with documents and references in sibling directories. Lerd keeps the existing `web.test`, `gastos.test` and port 43179 integration; the project-only startup wrapper ensures the private PostgreSQL dependency is running before starting the existing Node20 dev app. Apple Vision processing remains local. No new application login, public tunnel, remote host purchase or global startup service was added.

The operator paused the actual Lerd-managed writer before the fresh SQLite backup. All 18 tables matched the rehearsal after verified receipt-path relocation, with no financial/review/rule changes. Fresh PostgreSQL reconstruction, semantic replay, backup and relocated restore passed: 56 tables, 144 objects and 148 archive payloads. Two prepared runtime files explain the object-count increase from rehearsal; they are not financial observations.

Private current records:

- `qa-output/accounting-cutover/20261025/authorization.json`
- `writer-freeze.json`, `live-sqlite-frozen.receipt.json`
- `pg-live-data/recovery-receipt.json` and its source comparison/fact bridge
- `prewriter-rollback-rehearsal.json`
- `configuration-switch.json`, `live-idempotent-upload.json`
- `postcutover-verification/final-postcutover-verification.json`
- `post-live-postgres.receipt.json`, `cutover-complete.json`

The original SQLite snapshot was restored and successfully booted in isolation before resuming the PostgreSQL writer. Post-cutover, an existing-statement upload returned a duplicate result without increasing four journals or 55 source revisions. Both languages, source PDFs and receipt associations passed actual live checks; SQLite bytes remained unchanged. A second managed pause produced the final post-live backup and the app was resumed again.

Post-live archive SHA-256: `50b124d77f4e12439e07a15ff415c781140869e18fedc9408cb8234c7c3d0725`.

The source revision is `worktree:c1f353c310b8b5244b3a2f834a98507d135213d7:8aadc8aed3b0aaff59de4b49089190cf7bc056a4948a8e1a17f8494d7442e8d7`. Original rehearsal archives remain unchanged. Original reconstruction `complete` / `reportParityProven` flags remain false because they describe incomplete historical reconstruction; the separately scoped opening-mode release and executed cutover proofs pass without inventing that history.

After PostgreSQL accepts activity, rollback must freeze both systems and preserve/export/reconcile new commands and evidence. A backend flag change to older SQLite is not lossless rollback. Prefer repair forward or a compatible verified PostgreSQL restore until a reverse transformation is proven. Do not delete the old data, candidate archives or post-live evidence during cleanup.
