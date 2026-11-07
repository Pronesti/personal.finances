# Tarjetas API

Independent Laravel 13 / Sanctum JSON application. Run PHP and Composer using this machine's `~/.config/agent-skills/runtime.md`. No Node, frontend build, Next.js or application views are needed to install or serve this artifact.

The committed rebuild contract starts at `../docs/rebuild/START-HERE.md`. `openapi.json` describes the implemented versioned contracts. The public surface covers sessions, retained documents, native accounting/source inspection and receipt intake/correction/product review/reconciliation. Receipt intake requires authenticated trusted-ingress deadlines and fails closed when that boundary is absent. Statement intake/history and explicit historical receipt associations/full refunds are exposed through versioned contracts. Remaining classification/product-rule/settings workflows and analytical reports remain pending. See `ingress/README.md` for local-only ingress acceptance and its production limitations. Existing accounts and their private ledger must already exist; public registration and production provisioning are outside scope.

## Installation

From this directory, `composer install` installs the lockfile. Configure a private `.env` using `.env.example`, generate a new application key only for a new installation, and run explicitly targeted PostgreSQL migrations. Health is public/stateless and needs neither a database nor an application key. Session/financial requests need PostgreSQL and an application key. There is no SQLite connection or fallback. Never copy an existing installation's environment into test configuration.

The browser SPA talks directly to the API origin. CORS accepts only the configured complete origins; Sanctum stateful hosts have no schemes. Session cookies use the configured shared parent, Secure, HttpOnly and SameSite=Lax; XSRF-TOKEN is deliberately readable. Give every environment a disjoint cookie parent and separate session name. All API paths are `/api/v1/*` except Sanctum's `/sanctum/csrf-cookie`. Unknown API paths return JSON 404.

## Guarded acceptance

`.env.testing.example` and `.env.browser-testing.example` are templates, not target approval. The operator independently creates disposable databases/restricted roles and a protected `test_safety.target(marker uuid, environment text)` row. The database has an operator-selected `cluster_name`. The test role must not own the database, be privileged, inherit roles, mutate the marker or connect to another non-template database.

The operator maintains a read-only local JSON registry outside the checkout:

```json
{"targets":{"operator-selected-id":{"approved":true,"environment":"testing","host":"127.0.0.1","port":55451,"database":"operator-selected-disposable-db","role":"restricted-test-role","server_id":"operator-selected-cluster-name","marker":"operator-selected-uuid","roots":{"documents":"/absolute/private/documents","references":"/absolute/private/references","temp":"/absolute/private/temp"},"protected_roots":["/absolute/live-root"]}}}
```

Set `TARJETAS_TEST_TARGET_ID` and `TARJETAS_TEST_TARGET_REGISTRY`; use absolute canonical, non-symlink, writable roots with no group/other permissions. All three roots must be disjoint, including against protected live roots. The registry must have no write permission bits (e.g. 0400). Blank/mismatching configuration denies access. The guard uses final resolved connection settings and a read-only PostgreSQL identity/marker/privilege probe. It never initializes schema or repairs targets.

Run `php artisan tarjetas:test-target:check --env=testing`, then `php artisan migrate --env=testing`, then `php vendor/bin/phpunit`. PHPUnit's early bootstrap and PostgreSQL base case repeat the guard before hooks. Migration/destructive Artisan commands and test HTTP middleware independently enforce the boundary. Pure tests can run without a database via `php vendor/bin/phpunit --testsuite=Unit,Feature`. Stateless health remains outside test HTTP checks so it can prove liveness when PostgreSQL is unreachable.

Browser acceptance uses the separately approved browser environment, real CSRF middleware (`APP_ENV=browser-testing`), database sessions and synthetic factories. After the guard/migrations, `php artisan db:seed --env=browser-testing` creates only the two synthetic acceptance users and owner-qualified fixture document references. The synthetic password appears in the test code and is never intended for ordinary accounts. Seeding directly repeats the guard. Re-running it verifies existing owner mappings and object bytes. Immutable objects may remain if a SQL transaction rolls back; no filesystem transaction is claimed.

Run the test API with `php artisan serve --env=browser-testing --host=127.0.0.1 --port=8191 --no-reload`, proxy it through the approved HTTPS API `.test` host, and start the separate SPA. `artisan serve` is for local acceptance only. The deployment still requires actual FPM/ingress settings, protected deadline transport, private processing readiness, and separately authorized production smoke/recovery.
