# Laravel API and React SPA architecture

This is the mandatory architecture for the Tarjetas rebuild. It replaces the reference app's Next.js server runtime and single-user access model while preserving the financial behavior and fixtures in the [build specification](README.md). This revision is a plan and contract update: `backend/` and `frontend/` have not been scaffolded, and no claim of working Laravel authentication or browser-to-API integration is made yet.

## Required structure and boundaries

Use one repository with two independently executable applications:

```text
backend/
  app/Domain/                 financial use cases, ledger ownership, evidence, reports
  app/Http/                   controllers, request validation, authorization, API resources
  bootstrap/app.php
  routes/api.php              versioned financial routes; stateless health exclusion
  routes/web.php              JSON session endpoints with session and CSRF middleware
  database/migrations/        financial model, ownership, authentication and sessions
  processing/                 private PDF/OCR helpers and their locked dependencies
  tests/
  composer.json
  composer.lock
  .env.example
frontend/
  src/api/                    typed direct HTTP client and error handling
  src/auth/                   session state and protected client routes
  src/features/               the 32 financial destinations and their actions/charts
  src/i18n/
  package.json
  package-lock.json
  vite.config.ts
  .env.example
docs/rebuild/                 this specification and portable acceptance inputs
```

The folder names below `app/` and `src/` are suggested ownership boundaries; `backend/` and `frontend/`, direct HTTP, and separate artifacts are required. Laravel serves JSON and authorized document streams. React is a standalone SPA built by Vite. No Inertia, Blade-rendered application screens, Laravel React starter kit, Next.js server actions, or production dependency on the old `web/` is permitted. A JSON route using Laravel's `web` middleware is not a Blade screen.

The frontend connects directly to the configured Laravel origin. A same-origin Vite `/api` proxy must not be the only tested integration path, since it would hide CORS/cookie mistakes. The backend must not need `frontend/node_modules` or `frontend/dist` to install, test or start. The frontend must not need Composer, PHP, private document directories or a backend source import to build. Shared generated API types may be checked in as a versioned contract.

Port authoritative monetary, posting, authorization and reporting behavior into the backend. Preserve the supplied JSON outcomes with a PHP/domain adapter; original TypeScript adapters are reference evidence, not a required runtime. Use exact integer/decimal input handling and arbitrary-precision intermediate arithmetic for proportional products that can exceed PHP's integer range. Do not replace BigInt-based allocation with floating-point division. Browser calculations must not decide financial postings.

## Preimplementation inspection and decisions

Before scaffolding or altering infrastructure:

1. Verify the repository and all applicable `AGENTS.md` instructions. Inspect Git status, branches, locks and existing source/configuration. The reference source is `c3ad289`; the rebuild branch `feat/laravel-react-rebuild` starts from `main` at `e37b1c7`, with the same baseline file tree, and carries the committed handoff. Inspect the actual destination checkout instead of assuming its branch or local state. Preserve `web/`, the handoff, private data and existing Lerd site names. Do not rename/delete `web/` or switch its live PostgreSQL database as part of scaffolding.
2. Read `~/.config/agent-skills/runtime.md` on the actual execution machine before PHP/Composer commands. The inspected profile requires `lerd php ...` and `lerd composer ...` from the applicable project directory. Discover Lerd sites first; discover configured workers before starting any. Work in the existing checkout. An additional project copy, clone, checkout or worktree requires explicit user permission and an absolute destination outside the primary project directory; if a worktree is authorized, create it with Lerd tooling. Follow the feature-branch/PR workflow only when delivery actions are authorized.
3. Resolve package versions and extensions from the chosen runtime and official documentation. Record the exact resolved versions/lockfiles; do not install prereleases or change global PHP/Node settings to accommodate this app. The inspected machine has PHP 8.4/8.5 and Node 20/22/24/25 installed. Its DNS health reports `.test`; recheck DNS configuration before site/TLS changes on another machine.
4. Record the production parent domain, certificate/access setup, PostgreSQL/private storage, session store and OCR host. Cookie authentication requires compatible frontend/API subdomains under a controlled shared parent. Production OCR must have access to the supported private macOS processing runtime. These deployment values are prerequisites, not inferred from a developer's machine paths.

| Decision | Status and effect |
| --- | --- |
| Laravel API plus separate React/TypeScript/Vite SPA | User-required. All domain API routes use `/api/v1`; framework CSRF bootstrap is the documented exception. |
| PostgreSQL only | Previously accepted. No SQLite fallback/runtime is part of the rebuild. |
| Multiple users with isolated finances | User-confirmed. The single-user SQL is a baseline requiring ownership extensions, scoped constraints and isolation tests. |
| Registration and provisioning | Explicitly outside scope. Do not add registration, invitations, account-administration screens, production provisioning commands or public signup routes. Authentication assumes existing users; synthetic test factories may create fixture users. Operational documentation must state the existing-account prerequisite. |
| Ownership implementation | Plan choice: one private financial ledger per user, shared PostgreSQL tables with mandatory `ledger_id` scope and composite relational constraints. No sharing, organizations, household membership or delegated access. |
| Session storage | Plan choice: PostgreSQL-backed Laravel sessions, shared by API replicas. Session IDs are cookies; no browser-stored bearer/access/refresh tokens. |
| Initial processing | Preserve bounded local processing and atomic admission. Helpers belong to the backend artifact. Do not silently introduce asynchronous response semantics or an external OCR provider. |
| Production hosting details | Must be recorded before deployment; illustrative domains below are not provisioned or purchased. A Linux-only PHP container cannot directly execute Apple Vision. |

## Compatible stable versions

As checked on November 4, 2026, use Laravel **13.x** with a compatible stable **Sanctum 4.x**, PHP **8.5**, React/React DOM **19.3.x**, Vite **8.3.x**, and a supported stable TypeScript release accepted by the chosen scaffold. Pin actual resolutions in the two application lockfiles. Laravel 13 supports PHP 8.3–8.5, and Sanctum's current compatibility constraints include Laravel 13. [Laravel releases](https://github.com/laravel/docs/blob/13.x/releases.md), [Sanctum compatibility](https://github.com/laravel/sanctum/blob/4.x/composer.json), [React versions](https://react.dev/versions), [Vite releases](https://vite.dev/releases).

Use installed **Node 24 LTS** for this plan; it is a supported stable choice compatible with Vite's documented minimums. Do not copy the reference app's Node 20 pin into a new deployment, or select the installed Node 25 merely because its number is larger. Pin per-app versions without changing other projects. PostgreSQL 18 remains the supported reference financial database. Recheck version compatibility when implementation starts rather than treating this dated selection as permanent. [Node release status](https://nodejs.org/en/about/previous-releases), [Vite runtime requirements](https://vite.dev/guide/).

## Multiple users and financial ownership

Add `users` and a `ledgers` relation with an immutable ledger UUID, unique `owner_user_id` referencing a user, and creation metadata. One user owns exactly one private ledger in this scope. If an existing authenticated user has no ledger, return a controlled setup error until an authorized setup process supplies one; never fall back to a global/default ledger or auto-claim existing data. Test factories can create both records in a disposable database.

Resolve the ledger from the authenticated user on the server. Never accept a request body/header/query `user_id`, `owner_user_id` or `ledger_id` as authority to select another ledger. Resolve every key inside the caller's ledger. An exclusively other-owner key returns 404 without disclosing its existence. A logical ID or hash present in both ledgers resolves to the caller's own resource and may return 200; equal keys do not designate the other owner. Cross-owner writes and downloads must fail just as reads do.

The financial schema needs an explicit ownership design migration before it can be called safe for multiple users:

- Add non-null `ledger_id` to every owner-specific financial/evidence/catalog/review/reconstruction table. Migration tracking and explicitly shared immutable public IPC/MEP references are global metadata; users, sessions and ledger ownership have their own platform schema. The original `schema_migrations` is provenance, distinct from Laravel's `migrations` table.
- Use a globally unique single-column UUID primary key (`row_id`) on every Eloquent-managed financial model, and preserve the baseline logical `id` as a separate field with `UNIQUE (ledger_id, id)`. Stable accounts such as `expense:food:groceries:pantry` retain that logical ID in each ledger. Scope card IDs, source-derived IDs, fiscal identities and command keys similarly. Eloquent does not support composite primary keys; configure its key explicitly and never let its default `id` convention identify a logical account globally. Physical composite join tables use an explicit ledger-aware query repository, not composite-key Eloquent models. Composite FKs still enforce owner equality; see [implementation safeguards](implementation-safeguards.md).
- Enforce same-ledger relational references using composite FKs, for example journal/account, source/revision, purchase/version, billing/component, receipt/link, correction and opening-obligation evidence. A controller policy alone does not prevent an incorrectly inserted cross-owner reference.
- Rewrite source-chain, receipt-ownership, account-tree and posted-journal triggers to include `ledger_id` in every relevant lookup, aggregate and immutability check. Scope transactional locks by ledger. Inspect every JSON-derived relationship and generated column, including product IDs, for owner validation; JSON fields do not acquire isolation automatically.
- Account/catalog defaults, product identities/code ownership, merchant rules/merges/proposals/rejections, alerts, source review and reconstruction history belong to a ledger. Do not mutate a shared chart or use an unscoped global product/merchant cache.
- Read models, report queries, background processing context, command receipts, retry lookups, deduplication and temporary files carry the owner scope. Cache keys include ledger and relevant locale/value/scope inputs. Clear frontend financial/session caches on logout or user change.
- Store bytes under an opaque ledger namespace such as `<document-root>/ledgers/<ledger-uuid>/objects/<sha256>`, with pending evidence under the same owner boundary. URL hashes never grant access. Identical bytes uploaded by two users may yield equal content hashes but separate authorized references; replay within one user cannot reveal or return the other user's receipt, document or admission status.
- No ordinary-user API can export all ledgers or restore the database. Administrator recovery must preserve owner mappings, and user exports must contain only the authenticated owner's evidence and records.

Keep all supplied financial outcomes unchanged **inside each ledger**. Run the same financial fixtures independently for A and B, then run the distinct sentinel and exclusive-key cases in [ownership fixtures](isolation-fixtures.json). Shared keys must resolve to the caller; exclusively other-owner keys must return 404. Equal data alone cannot prove isolation. Original single-user table counts and exact DDL cannot be advertised as the final owned schema. Do not assign pre-existing reference installation rows to a real user without a separate authorized migration and explicit ownership mapping.

## API and frontend routing contract

Configure the API prefix once, such as `apiPrefix: 'api/v1'` in Laravel's routing bootstrap; do not accidentally create `/api/api/v1`. API responses are JSON unless they intentionally stream an authorized document. SPA page routes are owned by React Router or an equivalent client router, not Laravel application views. [Laravel routing](https://laravel.com/framework/docs/13.x/routing).

| Method and path | Access and purpose |
| --- | --- |
| `GET /api/v1/health` | Public, stateless API liveness; exclude stateful/session/auth/ledger middleware, retain CORS; HTTP 200 with `{"status":"ok","service":"tarjetas-api","api_version":"v1"}`. No private config, user data, exception traces or database identifiers. |
| `GET /sanctum/csrf-cookie` | Framework session/CSRF bootstrap, HTTP 204; the deliberate non-versioned framework endpoint. |
| `POST /api/v1/auth/login` | JSON credential login with session and CSRF middleware plus throttling. Existing users only. HTTP 200 with minimal current-user/ledger metadata, no authentication token. |
| `GET /api/v1/auth/user` | `auth:sanctum`; current user/ledger metadata or JSON 401. |
| `POST /api/v1/auth/logout` | Authenticated session invalidation and CSRF rotation; HTTP 204. |
| `GET /api/v1/bootstrap` | Authenticated owner's cards, catalog labels/settings, available report months and display metadata. |
| `GET /api/v1/reports/{report}` | Authorized owner-scoped report projections for the original financial destinations, using validated spend/value/tax/granularity/period filters. |
| `POST /api/v1/statements/import` | Authorized multipart file/card import; replacement for old `/api/upload`. |
| `GET /api/v1/statements` | Owner-scoped statement history. |
| `POST /api/v1/receipts/import` | Authorized multipart receipt intake; replacement for old `/api/receipts`. |
| `POST /api/v1/receipts/corrections` | Authorized `{sha256,rowsText}` correction; replacement for old `/api/receipts/corrected`. |
| `GET /api/v1/receipts` and `GET /api/v1/receipts/{id}` | Owner-scoped list/detail. |
| `GET /api/v1/documents/{hash}` | Authorized owner-scoped immutable bytes, fetched by the SPA credentialed client and opened as a blob; replacement for old `/api/accounting/documents/{hash}`. |
| `/api/v1/accounting/*`, `/api/v1/review/*`, `/api/v1/catalog/*` | Explicit read/action endpoints for journals, evidence, receipt funding/allocation/linking, product/code review, scoped classification, merchant merges/proposals, alert state and catalog/groups. Specify verbs/payloads in OpenAPI before implementing consumers; do not expose unrestricted database CRUD. |

Preserve the original 32 financial SPA destinations, adding `/login` and session-expiry handling. Dynamic reference paths such as `/receipts/[id]` mean client routes such as `/receipts/:id`. Deep-link refresh must serve the frontend's `index.html`. The Laravel API must never return that SPA fallback for an unknown `/api/v1` path.

Publish an OpenAPI v1 contract as part of implementation, including exact action paths, request/response schemas, upload limits, error codes, pagination, idempotency and optimistic versioning. Preserve the fixture's domain error meanings. Use JSON 401 unauthenticated, 404 unknown/other-owner resource, 419 CSRF mismatch, 422 form/receipt verification errors, 429 throttling and structured 400 domain input errors. A retained financial review is normally a successful intake with reviews, not an unstructured 500. Error bodies include stable code/message key and parameters; receipt failures retain their report/transcript correction payload. `Accept-Language` follows the SPA's explicit en/es choice; absent choice defaults to English.

Use `Idempotency-Key` for financial command requests and preserve it through retries; the backend qualifies it by the authenticated ledger before calling a use case. The same key and meaning in that ledger replay its result, changed meaning conflicts, and another ledger may use the same key independently. Preserve expected purchase/version and receipt-link predecessor checks. Do not replace a rejected request's key automatically with a new one merely to bypass its concurrency result.

## Sanctum session and CSRF flow

Enable `$middleware->statefulApi()` in `bootstrap/app.php`, protect financial routes with `auth:sanctum`, and apply owner authorization after authentication. Put the versioned login/logout JSON endpoints in a session/CSRF-enabled route group, for example `web.php` with the explicit prefix; do not assume an otherwise stateless login route can create a working session. Sanctum's SPA configuration requires the allowed frontend host and credentialed client requests. [Sanctum SPA authentication](https://laravel.com/framework/docs/13.x/sanctum).

The public health route explicitly removes `Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful` from its API middleware group and has no `StartSession`, authentication or ledger resolver middleware. Keep CORS enabled for GET/OPTIONS. Do not apply database-backed throttling or other database-dependent middleware to this liveness route. Test the resolved middleware stack and an actual SPA-origin request, including when PostgreSQL is unavailable; neither may create a session or emit `Set-Cookie`. [Sanctum middleware source](https://github.com/laravel/sanctum/blob/4.x/src/Http/Middleware/EnsureFrontendRequestsAreStateful.php).

The SPA first bootstraps CSRF at the API origin, submits credentials, and loads current-user state. Login must regenerate the session ID. Logout removes authentication, invalidates the session and regenerates its CSRF token. Reloading the SPA recovers identity using the session cookie and `/api/v1/auth/user`. Expiry returns the user to login and clears private cached data. There are no bearer-token issue/refresh routes, no `Authorization: Bearer` requirement, and no session/access/refresh tokens in localStorage, sessionStorage or IndexedDB. [Laravel session authentication](https://laravel.com/framework/docs/13.x/authentication).

Keep the session cookie HttpOnly, Secure in HTTPS environments, and SameSite=Lax for the controlled same-site subdomain arrangement. The XSRF cookie is readable by the SPA so its decoded value can accompany unsafe requests as `X-XSRF-TOKEN`; it is not an authentication credential stored in browser storage. Use the named session/cookie settings from the environment examples. [Laravel session configuration](https://github.com/laravel/laravel/blob/13.x/config/session.php).

Laravel 13 also has origin-based request-forgery checks. Preserve the token fallback and do not configure origin-only mode or same-site bypass as a substitute for the requested token flow. The SPA-to-API test uses distinct subdomains, so a missing/wrong token on an unsafe request must be rejected. Test this with actual middleware/browser requests; Laravel's normal test environment may bypass CSRF and would not prove this property. [Laravel request forgery protection](https://laravel.com/framework/docs/13.x/csrf).

Illustrative frontend client, to implement in `frontend/src/api/` rather than Laravel's frontend asset tree:

```typescript
import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL; // validate absolute approved URL
const apiOrigin = new URL(baseURL).origin;
const options = {
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json' },
};
export const api = axios.create({ ...options, baseURL });
const sessionBootstrap = axios.create({ ...options, baseURL: apiOrigin });
const publicApi = axios.create({
  baseURL, withCredentials: false, withXSRFToken: false,
  headers: { Accept: 'application/json' },
});

export async function login(email: string, password: string) {
  await sessionBootstrap.get('/sanctum/csrf-cookie');
  await api.post('/auth/login', { email, password });
  return (await api.get('/auth/user')).data;
}
export async function checkApiHealth() {
  return (await publicApi.get('/health')).data;
}
```

Axios must use its cross-origin XSRF option explicitly. With a different client, implement equivalent credential and header behavior. Never send the XSRF header or credentials to an arbitrary runtime URL supplied through a query string; the base URL is trusted deployment configuration. After a 419, refresh the session/CSRF state and preserve the form, but do not blindly replay a financial mutation with a new command identity. [Axios request configuration](https://axios-http.com/docs/req_config).

## Domains CORS and environment variables

Primary local browser origins are `https://app.tarjetas.test` and `https://api.tarjetas.test`; production examples are `https://app.finance.example.com` and `https://api.finance.example.com`, under the shared parent `finance.example.com`. These are examples, not configured sites. All such subdomains must be controlled/trusted. Use matching schemes, valid certificates and correct trusted-proxy handling.

Use separate cookie parents for development (`.tarjetas.test`), integration (`.tarjetas-integration.test`) and browser acceptance (`.tarjetas-browser.test`), with separate API/SPA subdomains inside each. Do not nest test hosts beneath a development cookie domain: the default `XSRF-TOKEN` cookie name would collide even with distinct session-cookie names. The environment examples and `test_environments` contract must agree, and the static verifier checks pairwise cookie-domain exclusion.

Publish Laravel's CORS configuration if the scaffold does not include it. Configure paths `api/*` and `sanctum/csrf-cookie`, exact allowed frontend origins, no wildcard origin/pattern, and `supports_credentials=true`. Allow the actually used verbs and headers, including Accept, Content-Type, X-XSRF-TOKEN and the chosen idempotency header. Let OPTIONS preflights run before authentication; they must not redirect to login. Expose Content-Disposition if the SPA reads download filenames. CORS is a browser policy, not owner authorization. [Laravel CORS configuration](https://github.com/laravel/framework/blob/13.x/config/cors.php).

`SANCTUM_STATEFUL_DOMAINS` contains frontend hosts, with ports if present, without scheme/path. `CORS_ALLOWED_ORIGINS` contains complete origins, including scheme and port. `SESSION_DOMAIN` is the shared parent cookie domain, with no scheme or port. If the browser uses a direct Vite port such as `https://app.tarjetas.test:5173`, include that exact origin in CORS and `app.tarjetas.test:5173` in stateful domains. Do not mix `localhost` and `127.0.0.1` between apps or use an unrelated frontend hosting domain with this cookie design. [Sanctum stateful configuration](https://github.com/laravel/sanctum/blob/4.x/config/sanctum.php).

The development plan examples are [backend.env.example](backend.env.example) and [frontend.env.example](frontend.env.example). Separate [integration-test](backend.testing.env.example) and [browser-test](backend.browser-testing.env.example) examples require independently authorized disposable PostgreSQL targets and roots; they must never inherit the development database. All custom test variables require explicit config mappings and the fail-closed bootstrap described in [implementation safeguards](implementation-safeguards.md). Copy them into each implemented app's own `.env.example` documentation, adjusting variable mappings deliberately:

| App | Variables and meaning |
| --- | --- |
| Backend | `APP_NAME`, `APP_ENV`, `APP_KEY`, `APP_DEBUG`, `APP_URL`; environment/secret key, JSON runtime origin and safe production debug setting. |
| Backend | `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `SANCTUM_STATEFUL_DOMAINS`; SPA origin, CORS allowlist and stateful hosts, wired into config explicitly. |
| Backend | `DB_CONNECTION=pgsql`, DB host/port/database/user/password; configure via the execution machine's Lerd environment tools/provider where applicable. |
| Backend | `SESSION_DRIVER=database`, unique `SESSION_COOKIE`, `SESSION_DOMAIN`, `SESSION_SECURE_COOKIE=true`, `SESSION_HTTP_ONLY=true`, `SESSION_SAME_SITE=lax`, `SESSION_LIFETIME`; implement mappings and create the session table. |
| Backend | `TARJETAS_DOCUMENT_ROOT`, `TARJETAS_REFERENCE_DIR`, `TARJETAS_PYTHON`, parser/OCR/helper paths and `ACCOUNTING_APP_REVISION`; private storage and backend processing identity. |
| Backend | Optional `ANTHROPIC_API_KEY`; server-only proposal provider secret. |
| Frontend | `VITE_API_BASE_URL`, e.g. `https://api.tarjetas.test/api/v1`; sole API base configuration. Changing it requires a new Vite build for static deployment. |

All `VITE_*` values are public build-time data. Do not copy `APP_KEY`, database passwords, document roots or provider secrets into frontend variables. Frontend and backend environments have separate files and deployment secret handling; a root `.env` must not be implicitly shared. [Vite environment variables](https://vite.dev/guide/env-and-mode).

## Local setup and development plan

After implementation, document a new-checkout setup using the repository's selected lockfiles. The intended command boundaries are:

```sh
# From backend/ after runtime resolution and configuration:
lerd composer install
# If the specified private MuPDF/Node helper is retained, install its own dependencies:
npm --prefix processing ci
npm --prefix processing run build
python3 -m venv .venv
./.venv/bin/python3 -m pip install -r processing/requirements.txt
lerd php artisan key:generate
lerd php artisan migrate
# Integration testing is a separate guarded operation described below.

# From frontend/ using its pinned Node/package manager:
npm ci
npm run dev -- --host 127.0.0.1
npm run typecheck
npm run test
npm run build
```

Before any integration test or destructive test setup, follow the dedicated PostgreSQL target guard and separate browser environment in [implementation safeguards](implementation-safeguards.md). Remove the scaffold's forced SQLite/array-session overrides; do not run `artisan test` against the development configuration. The planned `tarjetas:test-target:check` command must be implemented together with an independent early test-bootstrap guard before it is usable.

These are planned application commands, not commands executed during this documentation change. The backend processing directory must carry its own lockfile/build script and pinned Python requirements if that helper is retained; it cannot borrow the frontend's dependencies. Never generate/rotate the key of an existing installation as a setup shortcut. The frontend implementation must supply the documented scripts. If a lockfile/package-manager pin differs, use that manager's frozen install instead of copying npm commands mechanically. Resolve the host Python separately from the PHP runtime; Apple frameworks require macOS execution.

For the local Lerd environment, discover sites, register the backend root with PHP 8.5 and its `public/` document root, select PostgreSQL using `db set`, then run environment setup and mandatory framework setup/migrations. Use provider-managed service keys rather than hand-editing those keys. Inspect workers before starting any.

Register the frontend as a separate host-proxy/Vite site on its own loopback port, with the browser-visible HTTPS SPA subdomain and a correct secure HMR origin. Configure Vite's exact allowed development host and WebSocket path; do not solve host errors by exposing every host or publishing the dev server. The backend site must point to Laravel `public/`, not to the repository root. Do not modify the existing `web.test`/`gastos.test` application or its private database during this setup.

Read the actual runtime configuration before claiming the PHP worker can call host Node/Python. Container PHP cannot assume host Apple frameworks are available. The baseline complete receipt deployment uses the supported private macOS execution path; if PHP is elsewhere, design and approve a private macOS processing adapter with explicit owner context before asserting complete receipt support. External OCR and public document transfer are not authorized by this plan.

## Verification and required evidence

The following tests are required for the new implementation; old domain fixture results do not establish them:

1. **Independent builds:** install/test backend without frontend dependencies; build the SPA without backend source/dependencies or secrets. Build outputs are backend application/private helpers and frontend `dist/`.
2. **Real health integration:** unauthenticated `GET /api/v1/health` returns the fixed JSON, and the actual SPA public login screen obtains it over direct cross-origin HTTP, showing a restrained connected/unavailable state. With the actual SPA Origin/Referer, assert no Set-Cookie and no session-row change; repeat with PostgreSQL unreachable, including OPTIONS. Browser/network evidence must identify the API URL and response; a curl request or mocked fetch alone is insufficient.
3. **Browser session:** fetch CSRF, log in a synthetic existing user, inspect cookie attributes, reload and recover the session, access protected data, log out, then receive 401 for protected API requests. Login regenerates the session; logout invalidates it. No auth token is written to browser storage.
4. **CSRF/CORS:** missing/wrong CSRF on an unsafe distinct-subdomain request is rejected; valid XSRF succeeds. Exact trusted origin receives credentialed CORS headers; untrusted origins do not. Preflight succeeds without a session. Do not count a test with CSRF disabled as proof.
5. **Two users:** run identical financial fixtures separately, then the shared-key, exclusive-key, unequal-amount and mutation cases in `isolation-fixtures.json`. Shared IDs/hashes return the caller's resource; exclusively other-owner keys return 404. A cannot list/read/change/download/link/reclassify B's data through guessed keys, query filters or forged owner fields. Their distinct report totals and metadata expose accidental global queries. Own identical commands succeed independently; replay is owner-local. Raw PostgreSQL cross-ledger references use an account exclusive to B paired with ledger A and must fail with SQLSTATE 23503; colliding-key positive controls succeed inside each owner. Test application forged-owner rejection, ORM saves and route binding separately. Test the actual original-PDF button using the credentialed blob workflow, popup-blocked behavior, 401 expiry and 404 other-owner responses.
6. **Isolation after lifecycle changes:** owner scoping survives job/retry context, cache hits, session expiry, switching users in one browser, financial corrections, document deduplication and administrator restore. No previous user's financial cache flashes after login to another account.
7. **Financial and presentation parity:** all supplied numerical fixtures pass via the Laravel adapter, followed by all original 32 financial SPA route journeys in English/Spanish, mobile/desktop and light/dark. Authentication adds requirements without changing native financial results.
8. **Operational checks:** dedicated PostgreSQL test-target guards must refuse unsafe configuration before destructive hooks. Real PostgreSQL guards/concurrency/reload, local parser/OCR, reference refresh and owner-aware backup/restore pass. Run `isolation-fixtures.json` recovery with equal hashes in two ledgers, exclusive objects, pending transcripts and invalidated old sessions. Verify exact upload boundaries and timeout handling through the deployed HTTP/FPM/proxy stack as specified in the safeguards, including a trusted start/deadline issued before buffering and a combined delayed upload/queue/worker test. PHP entry never restarts the deadline or non-OCR counter. Normal queue/phase tests enforce the earlier cumulative 180-second non-OCR limit; the 720-second outer-watchdog scenario is explicitly isolated fault injection, never normal acceptance. PHP syntax/style/static checks and frontend type/lint/build tests follow implemented project scripts. Capture request/console/network issues through Lerd diagnostics when using its browser surface.

`architecture-contract.json` provides a machine-readable plan and two synthetic identities. `verify-architecture-plan.py` checks document/environment consistency only. Until a new backend and SPA exist and the browser tests above pass, report API reachability, Sanctum and multi-user isolation as **required, unverified implementation acceptance**, not completed work.

## Required implementation safeguards

[Implementation safeguards](implementation-safeguards.md) is a mandatory part of this architecture: it defines ORM key mapping, owner-qualified recovery, stateless health, authenticated document viewing, disposable test isolation and end-to-end upload/time budgets. The [synthetic isolation fixture](isolation-fixtures.json) specifies data and exact ownership/recovery outcomes; [deadline fixtures](deadline-fixtures.json) specify elapsed-time and trusted-metadata outcomes. Both supplement the original financial goldens without altering them.

## Independent production deployment

Deploy Laravel to the API subdomain, web document root `backend/public/`, with the target machine's PHP/Composer conventions. Its artifact contains Composer runtime dependencies, private processing helpers/dependencies and migrations; it contains no frontend build requirement. Use production configuration, stable `APP_KEY`, debug disabled, explicit trusted proxies, persistent private storage, PostgreSQL and the shared session store. Run planned migrations as a controlled deployment step and cache configuration/routes after environment values are final. Do not serve source/private directories. [Laravel deployment](https://laravel.com/framework/docs/13.x/deployment).

Build the SPA in a separate job with its production `VITE_API_BASE_URL`, then deploy only `frontend/dist/` to the frontend subdomain. Configure static history fallback to `index.html` for frontend deep links, immutable caching for content-hashed assets and revalidation for HTML. Do not use Vite's development or preview server as production hosting. A frontend rollback must not require a backend rebuild, and an API deploy must not rebuild the SPA; maintain backward-compatible v1 responses during independent rollouts.

Set the production CORS origin, stateful host and cookie parent to the actual production domains, not the `.test` examples. Use HTTPS end to end as observed by Laravel's trusted-proxy configuration. Repeat health, login/reload/CSRF/logout and two-user document/report isolation against the deployed domains before declaring delivery. Record OCR/private storage readiness, the effective HTTP/FPM limits and deadlines from the safeguards, and an owner-qualified verified recovery point. The legacy global-path backup utility is not target-compatible unchanged. DNS purchase, host creation, credentials, public deployment and migration of the existing owner's data require their own concrete authorization; this plan does not perform them.
