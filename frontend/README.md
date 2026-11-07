# Tarjetas SPA

Standalone React/TypeScript/Vite application, pinned to Node 24. It builds without PHP, Composer, backend source, private roots or backend secrets.

Run `npm ci`, set `VITE_API_BASE_URL` from `.env.example`, then `npm run dev`. HTTPS `/api/v1` at the real API origin is required. There is no Vite API proxy. `npm run typecheck`, `npm test`, and `npm run build` verify the client artifact. The output is `dist/`; deployment serves it with frontend history fallback to `index.html`, revalidated HTML and immutable hashed assets. Do not use Vite dev/preview as production hosting.

`npm run test:browser` runs Playwright against the separately guarded browser environment and synthetic accounts. Install its Chromium with `npx playwright install chromium`. Trust the local development CA in Node using `NODE_EXTRA_CA_CERTS` when needed; do not disable TLS checks. The committed browser test uses the full Chromium PDF viewer. The backend must be independently guarded, migrated, seeded and running first. Browser tests do not provision/reset databases. Login throttling remains active; allow its one-minute window between repeated runs or clear only the explicitly guarded acceptance environment's cache.

Session state exists in memory and Secure cookies. No auth token is written to browser storage. The client requests the CSRF cookie at the API origin and explicitly enables credentialed, cross-origin XSRF transport. 401 clears private state; 419 retains entered values and does not automatically replay mutations. Logout failures remain visible so the user can retry. Original documents are fetched by the authenticated client and opened through a reserved blob viewer, with blocked-popup fallback and cleanup on logout/unmount/viewer closure.

Current screens include authentication, retained document viewing, native accounting balances/journal inspection and source-evidence detail. The financial overview, settings/review actions and analytical destinations remain pending. These screens do not establish full acceptance of the 32-destination rebuild.
