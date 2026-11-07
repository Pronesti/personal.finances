# Rebuild implementation evidence

This implementation record supplements the frozen handoff. It does not change fixture expectations or the historical validation record.

## Foundation milestone — November 7, 2026

Verified the existing checkout remote is `https://github.com/Pronesti/personal.finances.git`; fetched and switched from a clean `dev` to `feat/laravel-react-rebuild`, fast-forward-only, retaining handoff `b0cc5641ddaee795fcf89faa472226e2b2bd9e17`. No additional project copy/worktree was created. `web/` and existing private data remain untouched.

Read all nine requested handoff documents. Before dependency installation, package verification passed (26 hashed fixtures, 32 route contracts, 85 accounts, 11 groups); architecture verification passed 278 checks; 37 negative regressions were rejected in memory.

The actual machine runtime profile specifies plain `php` and `composer`. Discovery found Yerd (not the handoff machine's Lerd CLI), native PHP 8.5.10, Composer 2.10.3, Node 24.22.1, PostgreSQL 18.4, `.test` resolver on 127.0.0.1:1053, HTTPS forwarded from 443 to 8443 and HTTP from 80 to 8080. Existing services were preserved. New local acceptance proxies are `tarjetas-rebuild-api` → 127.0.0.1:8191 and `tarjetas-rebuild-spa` → 127.0.0.1:5191 with `api.tarjetas-browser.test` / `app.tarjetas-browser.test` as their primary domains.

The user explicitly approved a separate PostgreSQL 18 cluster on 127.0.0.1:55451, `tarjetas_integration_disposable` / `tarjetas_browser_disposable`, restricted per-environment roles, and private roots under `/Users/pronestivm/.local/share/tarjetas-rebuild-acceptance`. Only those targets were initialized/migrated. A separate operator role owns their protected markers; test roles cannot modify markers or connect to the other databases. Local secrets and the read-only operator registry remain outside Git. Session cookies use the disjoint integration/browser parents from the handoff.

Resolved application locks: Laravel 13.40.0, Sanctum 4.3.3, React 19.3.1, Vite 8.3.6, TypeScript 7.0.2. Dependencies were resolved from stable package registries. No global runtime version was changed. The initial Laravel scaffold's mixed frontend, welcome Blade screen, SQLite connections and automatic migration/setup scripts were removed from the new backend.

Implemented:

- Independent backend/frontend installs and SPA build; versioned JSON API with an initial OpenAPI contract.
- Stateless public health with explicit Sanctum middleware exclusion and exact CORS; database sessions, existing-account login, ID regeneration, reload/current user, CSRF-protected logout and token rotation. No registration or token issuance; Sanctum bearer retrieval is disabled.
- Immutable private ledger owner mappings; server-resolved ledger middleware rejecting conflicting owner fields; owner-qualified catalog/document tables, surrogate Eloquent account keys and composite account-revision FK.
- Canonical private storage checks, retained document hash/size verification, owner-qualified object/pending namespaces, credentialed original-PDF blob viewer, popup fallback and logout cleanup.
- Fail-closed disposable target guard, independent command/test/HTTP checks, read-only target identity/marker/privilege probes, synthetic factories and guarded seeding.
- Bilingual session UI, explicit language cookie (`lang`), OS appearance and responsive authentication form. The financial shell is intentionally marked as pending implementation.

Executed foundation checks:

- PHPUnit: 9 tests / 53 assertions, including PostgreSQL immutable ownership, actual `accounting.account_name_revisions` foreign-key SQLSTATE 23503 with three successful controls, rollback/state checks, surrogate-key save isolation and unsafe target refusals.
- Frontend TypeScript, Vitest trusted-URL case and production build passed.
- Four Chromium browser journeys passed against the separate HTTPS origins: direct health, real missing-CSRF rejection, login/reload/logout and cookie attributes, no browser-storage tokens, cross-owner document rejection/forged owner conflict, actual PDF button/blob bytes and viewer cleanup, popup-blocked fallback, bilingual retained login form, and CORS/preflight. Chromium uses the real PDF viewer; headless-shell PDF support was insufficient. TLS verification remained enabled with the local CA.
- Composer strict validation and Pint passed.

## Pending obligations

This is not a completed rebuild or financial release. The complete owned financial schema/guards, financial command use cases and idempotency/concurrency, frozen financial/report adapters, statement parsing, bounded Vision receipt OCR/correction, review workflows, all 32 financial destinations/charts, recovery/reconstruction/reference operators and full deployment acceptance remain pending. The first browser tests do not establish numerical/report parity, complete two-user financial isolation, recovery, disjoint-environment cookie coexistence, or all document/error/session-expiry cases.

The user explicitly deferred production hosting selection. The discovered Yerd FPM settings are 60-second execution/input, 100 MiB upload/post and 20 files; they do not meet the rebuild settings and were not globally changed. Its discovered configuration does not establish a first-byte/pre-buffering request deadline, phase accounting or downstream cancellation. No synchronous import readiness, production ingress acceptance or deployment is claimed. Native PHP runs on macOS here, but Python Vision/Quartz/pdfplumber were absent from the discovered host interpreter; processing dependencies and measured budgets still need a separate backend-local environment. No external OCR/provider processing change was made.

## Native ledger milestone — November 7, 2026

Added owner-qualified PostgreSQL cards, evidence, command receipts, journal headers/lines/evidence, purchase versions, billings/components, payments/attributions, linked credits, correction/credit/component/attribution revision histories and opening obligations. SQL posting/immutability/account-tree guards and composite owner FKs remain active. Locks serialize by ledger. Canonical account defaults are now an independent backend resource; card liability trees are initialized by explicit per-ledger bootstrap. Group/review/source schema work remains pending.

Ported exact minor-unit validation, decimal source admission, arbitrary-precision proportional products through Brick Math, deterministic rounding order, ordered repayment attribution, later issuer reservation, explicit partial issuer allocation, empty latest attribution markers, native purchase/billing/repayment/credit commands, classification reversals/replacements and supported opening billings. No unrestricted financial CRUD endpoint was introduced.

Executed PHPUnit: **17 tests / 159 assertions**. The frozen native ledger scenario runs separately for two factory owners through PostgreSQL and reloaded repositories, including every checkpoint, exact billing shares, eight journals, original effective dates/later recording time, version 2, purpose expenses/outstanding amounts, replay, key conflict, stale version and principal-change review. The opening case proves zero acquisition/expense and replay/excess refusal. Real raw-SQL posting cases prove balance, evidence, posting-leaf and posted deletion guards. Two simultaneous independent PHP processes prove identical commands result in one posting and one duplicate with the same journal IDs; competing correction keys result in one version-2 update and one stale-version failure with no extra journals. The concurrency case deliberately retains only synthetic rows in the approved integration target; rollback-based cases leave no rows.

This is core persistence/domain evidence, not statement/receipt intake, complete financial fixture acceptance, report parity or browser financial-screen acceptance. No production deployment or live-data migration occurred.
