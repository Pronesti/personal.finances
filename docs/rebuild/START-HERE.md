# Continuing the Tarjetas rebuild on another computer

Continue on `feat/laravel-react-rebuild`. This branch starts from `main` at `e37b1c780632e9df9c50bd8e85b877774c05ce34` and includes the complete rebuild handoff. The reference source is `c3ad289`; both baseline commits have the same file tree. The Laravel backend and React SPA are still to be implemented.

## Open the branch

Use the existing Tarjetas checkout on the destination computer. If there is no checkout, have the operator choose and authorize an absolute destination before creating one. An agent must obtain explicit permission before creating an additional project copy, clone, checkout or worktree, and must keep any authorized extra copy outside the primary project directory.

From the repository root, inspect local work first:

```sh
git status --short
git fetch origin
```

If the rebuild branch does not exist locally:

```sh
git switch --track origin/feat/laravel-react-rebuild
```

If it already exists locally:

```sh
git switch feat/laravel-react-rebuild
git pull --ff-only origin feat/laravel-react-rebuild
```

Preserve existing work. A conflicting switch or non-fast-forward update needs reconciliation; do not force it or discard changes. Continue implementation on this same feature branch. Do not recreate it from a newer `main` and lose the handoff commit. Follow the project's PR workflow to `dev` and `main`; do not merge or rebase `dev` into this feature branch.

## Verify the handoff before installing dependencies

These checks need Python 3 and its standard library. They do not require PHP, Composer, Node, PostgreSQL, OCR, an environment file, production credentials or financial data:

```sh
python3 docs/rebuild/verify-package.py
python3 docs/rebuild/verify-architecture-plan.py
python3 docs/rebuild/verify-architecture-negative.py
```

Use the machine's equivalent Python 3 command if it is not named `python3`. The architecture check includes `verify-plan-boundaries.py`. Regression mutations run in memory without creating another project/package copy. The manifest covers the complete handoff and the 26 frozen financial fixture files. Do not regenerate the expected results to make an implementation pass.

The committed `.gitattributes` preserves LF line endings for handoff text and treats synthetic PDFs as binary, keeping manifest hashes stable across operating systems. Preserve those bytes; do not normalize or reformat frozen fixtures.

The reference adapters `verify-current.mjs`, `verify-parsers.py` and `verify-ocr.mjs` have additional source/runtime dependencies and are separate from these portable checks. `generate-fixtures.py` is an authoring tool, not a setup step.

## Read the implementation contract

Read these in order, then the contracts and fixture files they reference:

1. [Project context](../project-context-prompt.md): source features, entities, original SQL migrations and financial rules. This is a dated description of the reference app.
2. [Build specification](README.md): exact behavior, seed inputs, expected financial/report results, all 32 financial routes and staged acceptance.
3. [Architecture](architecture.md): required application boundaries, versioned API, authentication, ownership, environments and deployment.
4. [Implementation safeguards](implementation-safeguards.md): ORM keys, owner-qualified recovery, document viewing, test-target guards, disjoint cookie domains and composed processing deadlines.
5. [Architecture contract](architecture-contract.json), [isolation fixtures](isolation-fixtures.json), [deadline fixtures](deadline-fixtures.json), [verification record](validation.json) and `fixtures/`.

The target is PostgreSQL only, a Laravel API in `backend/` under `/api/v1`, and a standalone React/TypeScript/Vite SPA in `frontend/` using direct HTTP. Preserve the financial features and numerical fixtures inside each user's private ledger. Use Sanctum cookie authentication with CSRF and credentialed CORS. Keep authentication tokens out of browser storage. No Inertia, Blade application screens, Laravel React starter kit or Next.js target runtime. Registration and production account provisioning are outside scope; acceptance may use synthetic factory users.

## Resolve the destination runtime

Inspect this computer's repository instructions and `~/.config/agent-skills/runtime.md` before PHP or Composer commands. If that file is absent or unclear, establish the local runtime configuration before issuing project PHP/Composer commands. Do not infer it from the operating system or copy another computer's configuration blindly.

The recorded Lerd prefixes are `lerd php` and `lerd composer`; the destination machine's established profile controls execution. Discover Lerd sites and DNS mode before configuring hosts, TLS or workers. The documented package release lines and installed versions were checked on November 4, 2026; resolve compatible current stable versions and record actual lockfiles during implementation. Do not change global runtime versions for other projects.

Configure `backend/` and `frontend/` independently when they exist, using the committed environment examples as mappings. Read actual Lerd service/network configuration instead of assuming a database host. Supply new canonical private roots and explicitly selected disposable PostgreSQL targets for synthetic acceptance. Runtime setup creates secrets locally; no working environment file or real financial database is required in Git.

Receipt OCR currently depends on private macOS Vision execution. A Linux-only environment can develop the financial core and SPA, but complete OCR acceptance needs the supported macOS path or an explicitly designed private adapter. Resolve that execution boundary and the trusted ingress deadline/cancellation capability early. The long-request and phase-budget requirements cannot be proven with ordinary proxy timeout settings alone.

## Start implementation in stages

Begin with repository/runtime inspection, independent `backend/` and `frontend/` setup, the exact API contract and ownership migrations. Prove direct browser health access, Sanctum login/reload/logout, real CSRF/CORS and two-user database/document isolation before porting the financial workflows. Then follow the sequence in the build specification: financial core, evidence intake, review actions, reports/UI, and deployment/recovery verification.

Preserve `web/`, private data and existing service names. A change to or migration of the existing installation requires separate authorization and ownership mapping. Use the committed synthetic evidence for the rebuild. Static package checks do not prove a working backend, browser session, PostgreSQL constraint, OCR pipeline or deployed ingress.

## Kickoff prompt

Paste this into the project chat on the destination computer when ready to authorize implementation:

> Implement the Tarjetas rebuild on `feat/laravel-react-rebuild` in this existing checkout. Read `docs/rebuild/START-HERE.md`, `docs/project-context-prompt.md`, the full build specification, architecture, implementation safeguards, machine-readable contracts and synthetic fixtures before changing code. Preserve every accepted decision, existing work and private data. Inspect this machine's runtime configuration before PHP/Composer commands. Do not create another project copy or worktree without explicit permission. Build the Laravel API and standalone React/TypeScript/Vite SPA with PostgreSQL, Sanctum cookies/CSRF and isolated finances for multiple users. Registration and production account provisioning are outside scope. Start with the authenticated foundation and ownership/API contracts, verify each milestone, then continue through the specification's implementation sequence. Preserve the frozen financial outcomes. Report executed checks and remaining runtime/deployment prerequisites accurately; do not alter the live installation as part of synthetic setup.
