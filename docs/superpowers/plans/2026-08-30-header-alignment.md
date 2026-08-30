# Page Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The page title, the mode toggles and the granularity/period filters stop being page markup and become layout structure, so they sit at exactly the same pixel position on every route and no page can move them.

**Architecture:** The root layout renders a `PageChrome` client component above `{children}`. Chrome is driven entirely by the URL — `usePathname()` picks the route's row out of one `CHROME` table, `useSearchParams()` supplies the modes and the selected period — plus three request-scoped facts the layout loads once (the months on file, the newest closing date, the base month). Pages stop rendering titles, toggles and pills altogether: their header blocks are deleted, not rewritten. Position stops being a convention twenty-two files have to keep and becomes a property of the layout, because a page has no way to render chrome at all.

**Tech Stack:** Next.js 16 (App Router, React 19 server components), Tailwind CSS v4, vitest 4, TypeScript 5, better-sqlite3.

**Spec:** None written — the requirement is stated in full under "Problem" below.

## Problem

Today each page hand-rolls its own header, and they disagree:

- The header wrapper is `mb-6` on most pages, `mb-4` on `/categories` and `/sankey`, and absent on `/inflation` (`h1 mb-2`), `/review` (`h1 mb-2`), `/upload` (`h1 mb-4`) and `/recurring` (`h1 mb-4`).
- The title row is 30px tall on a page with a `ModeToggle` (28px button box + 2px border) and 28px tall on a page without one (the `h1` line box).
- The granularity pill row carries its own `mb-4` and exists on only twelve of the twenty-two pages.
- `/categories`, `/merchants` and `/sankey` render a second, conditional period row: switching granularity to `all` deletes that row and pulls the whole page up ~40px *within a single route*.
- The period row uses `flex-wrap`. Thirty months wrap to two lines, ten quarters to one — so changing granularity changes the row's height too.
- `/anomalies` puts its summary paragraph above its pills; every other page puts pills directly under the title.

Every one of these is the same bug: chrome is page markup, and twenty-two pages each got it slightly differently.

## Approach, and what it costs

Everything the chrome needs is already in the URL or is page-independent:

- **Title** — a per-route message key. Two titles name something: `/` names the latest closing date, `/sankey` names the selected period. Both are derivable outside the page.
- **Mode toggles** — `ModeToggle` is already a client component driven by search params. Its `baseMonth` is `latestMonth(loadCpi())` on *every* page. All that varies is which of the three toggles a route shows.
- **Granularity and period pills** — options come from the route (`GRANULARITIES`, or `MOVER_GRANULARITIES` on `/movers`), the period list from the months on file, and every page already builds the same two links: changing granularity preserves everything but `period`, changing period preserves everything.

So one table of twenty-two rows describes every page's chrome, and a new page gets its header by adding a row — a test fails if it does not.

Costs, stated plainly:

- Chrome renders on the client (it already does for `ModeToggle`; `Nav` is the same pattern). Pills become client-rendered links. The HTML is still server-rendered on first paint.
- The "why is this toggle hidden" comments move from the page to the table row. They are copied verbatim, not dropped.
- Pages still parse `g` and the modes for their own queries. That is unchanged — both the page and the chrome read the same URL, and after this plan they resolve the period through the same shared function instead of three near-identical inline copies.

## Global Constraints

- Node 20 (`web/.nvmrc` pins `20.19.5`). Run `nvm use` in `web/` before `npm test` or `npm run dev` — Homebrew Node 25 breaks `better-sqlite3`.
- All identifiers, comments and commit messages in English. User-facing prose lives in `web/src/lib/i18n.ts` in both `en` and `es`. **This plan adds no new user-facing strings** — every string it moves is an existing key.
- Work on the current branch. This repo commits straight to its working branch; do not open a feature branch.
- A dev server is normally already running on port 3000. Reuse it (`preview_start` with `{name: "tarjetas-web"}` reattaches); do not start a second one.
- Tailwind v4 with the design tokens in `web/src/app/globals.css`. Never write a raw colour — use `border-line`, `text-ink-muted`, `bg-accent` and friends.
- `vitest.config.ts` includes `src/**/*.test.ts` only (not `.tsx`). New tests must be `.test.ts`.
- `@/lib/params` imports `loadCpi`/`loadMep`, which read the filesystem. It must never be imported by a `"use client"` component. That is why Task 1 exists.
- There is no linter and `noUnusedLocals` is off, so `tsc` will not catch an import left behind by a deletion. Task 4 has an explicit sweep for that.
- Commands run from `web/`.

## Out of Scope

- The `/categories` breadcrumb row, which appears only when you drill into a category. It is page-local state, not cross-page navigation, and it is allowed to push content down.
- The `/habits` granularity pills. They scope one of that page's two charts, not the page, so they stay beside that chart and `/habits` gets no granularity row in its chrome.
- Whatever sits below the chrome: stat rails, chart heights, tables.
- `/movers` accepting `g=all` from a hand-typed URL even though it offers only three granularities. Pre-existing, unchanged.

## File Structure

**Created**

- `web/src/lib/scope.ts` — the pure "which bucket am I looking at" logic: granularity constants and parsing, period derivation, mode parsing, link building. Pure, so both a server page and a client component can import it. This is the file `params.ts` should have been split into the first time a client component needed one of its constants.
- `web/src/lib/scope.test.ts` — unit tests for the above.
- `web/src/lib/chrome.ts` — the `CHROME` table: one row per route saying what its header holds.
- `web/src/lib/chrome.test.ts` — asserts the table and the filesystem agree on the route list, and that no page renders a title of its own.
- `web/src/components/PageChrome.tsx` — the header itself, rendered by the layout. Two rows, both with reserved heights.

**Modified**

- `web/src/lib/params.ts` — keeps `valueOpts` (the only server-only thing in it) and re-exports the moved helpers, so no existing page import changes.
- `web/src/lib/queries.ts` — adds `chromeData`, the one read the layout does.
- `web/src/components/Pills.tsx` — loses its own margin and its wrapping; inside a fixed-height filter bar the caller owns spacing and the row must not wrap.
- `web/src/app/layout.tsx` — loads the chrome's three facts and renders `PageChrome`.
- `web/src/app/globals.css` — `scrollbar-gutter: stable`.
- All twenty-two `web/src/app/**/page.tsx` — header markup deleted.

---

### Task 1: Split the pure scope logic out of params.ts

`PageChrome` is a client component and needs `GRANULARITIES`, `granularityLabel`, `parseModes` and the period helpers. `params.ts` cannot give them to it: importing that module pulls `loadCpi`/`loadMep` — and the filesystem — into the client bundle. Move the pure half into its own module and have `params.ts` re-export it, so no existing caller changes.

This task also replaces the three inline copies of "which periods exist, and which one is selected" with one tested pair of functions.

**Files:**
- Create: `web/src/lib/scope.ts`, `web/src/lib/scope.test.ts`
- Modify: `web/src/lib/params.ts`

**Interfaces:**
- Consumes: `periodOf`, `ALL_PERIOD`, `Granularity` from `@/lib/months`; `translate`, `Locale`, `DEFAULT_LOCALE` from `@/lib/i18n`.
- Produces, all from `@/lib/scope` and re-exported by `@/lib/params`:
  - `type SP = { [k: string]: string | string[] | undefined }`
  - `const GRANULARITIES: readonly ["month", "quarter", "year", "all"]`
  - `const MOVER_GRANULARITIES: readonly ["month", "quarter", "year"]`
  - `parseGranularity(sp: SP): Granularity`
  - `granularityLabel(g: Granularity, locale?: Locale): string`
  - `periodWord(g: Granularity, locale?: Locale): string`
  - `spanLabel(g: Granularity, locale?: Locale): string`
  - `type Modes = { spend: SpendMode; value: ValueMode; tax: TaxMode }`
  - `parseModes(sp: SP): Modes`
  - `withModes(path: string, modes: Record<string, string>, extra?: Record<string, string>): string`
  - `periodsFor(months: readonly string[], g: Granularity): string[]`
  - `type PeriodMode = "latest" | "all-first"`
  - `resolvePeriod(periods: readonly string[], raw: unknown, mode: PeriodMode): string`
- `valueOpts(modes: Modes): ValueOpts` stays in `@/lib/params`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { periodsFor, resolvePeriod, parseGranularity, parseModes } from "@/lib/scope";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

describe("periodsFor", () => {
  it("keeps months as they are, in order", () => {
    expect(periodsFor(MONTHS, "month")).toEqual(MONTHS);
  });

  it("collapses months into their quarter, once each", () => {
    expect(periodsFor(MONTHS, "quarter")).toEqual(["2026-Q1", "2026-Q2"]);
  });

  it("collapses everything into one bucket at 'all'", () => {
    expect(periodsFor(MONTHS, "all")).toEqual(["all"]);
  });

  it("has no periods when nothing is on file", () => {
    expect(periodsFor([], "month")).toEqual([]);
  });
});

describe("resolvePeriod", () => {
  const periods = periodsFor(MONTHS, "month");

  it("takes a period the list actually has", () => {
    expect(resolvePeriod(periods, "2026-02", "latest")).toBe("2026-02");
  });

  // A label from another granularity is not valid here, so switching granularity has to fall
  // back rather than scope the page to a period that does not exist.
  it("falls back to the newest period when the label is from another granularity", () => {
    expect(resolvePeriod(periods, "2026-Q1", "latest")).toBe("2026-04");
  });

  it("falls back to the newest period when there is no param", () => {
    expect(resolvePeriod(periods, undefined, "latest")).toBe("2026-04");
  });

  // A repeated query param arrives as an array; it names no single period.
  it("ignores a non-string param", () => {
    expect(resolvePeriod(periods, ["2026-02", "2026-03"], "latest")).toBe("2026-04");
  });

  it("falls back to the whole history where that is the page's default", () => {
    expect(resolvePeriod(periods, undefined, "all-first")).toBe("all");
  });

  it("has an empty selection when nothing is on file", () => {
    expect(resolvePeriod([], undefined, "latest")).toBe("");
  });
});

describe("parsing", () => {
  it("defaults to month and to real accrual pre-tax", () => {
    expect(parseGranularity({})).toBe("month");
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });

  it("reads the query", () => {
    expect(parseGranularity({ g: "quarter" })).toBe("quarter");
    expect(parseModes({ spend: "cash", value: "usd", tax: "incl" }))
      .toEqual({ spend: "cash", value: "usd", tax: "incl" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- scope
```

Expected: FAIL — `Failed to resolve import "@/lib/scope"`.

- [ ] **Step 3: Create scope.ts**

Create `web/src/lib/scope.ts` with the pure helpers moved verbatim out of `params.ts`, plus the two new period functions:

```ts
import { ALL_PERIOD, periodOf, type Granularity } from "@/lib/months";
import { DEFAULT_LOCALE, translate, type Locale } from "@/lib/i18n";
import type { SpendMode, TaxMode, ValueMode } from "@/lib/queries";

// Everything here is pure: it reads the URL and the months on file and nothing else. That is
// what lets the page chrome — a client component — share it with the server pages, which
// `@/lib/params` cannot do because it also opens the CPI and MEP tables off disk.

export type SP = { [k: string]: string | string[] | undefined };

export const GRANULARITIES = ["month", "quarter", "year", "all"] as const;

// A mover is a change between two buckets, so the one-bucket "all" has nothing to compare.
export const MOVER_GRANULARITIES = ["month", "quarter", "year"] as const;

export function parseGranularity(sp: SP): Granularity {
  return sp.g === "quarter" ? "quarter"
    : sp.g === "year" ? "year"
    : sp.g === "all" ? "all"
    : "month";
}

// The name of a granularity as a pill reads it: "month", "quarter", "year", "all".
export function granularityLabel(g: Granularity, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `granularity.${g}`);
}

// Copy helper: "all" names a bucket, not a period, so prose that reads "each {g}" needs a
// neutral word for it. Pages that say "the latest {g}" want `spanLabel` instead.
export function periodWord(g: Granularity, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `period.word.${g}`);
}

// Prose for the span one bucket covers — "the latest month", but "the whole history" for "all",
// where there is only ever one bucket and "latest" would be meaningless.
export function spanLabel(g: Granularity, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `period.span.${g}`);
}

export type Modes = { spend: SpendMode; value: ValueMode; tax: TaxMode };

export function parseModes(sp: SP): Modes {
  const spend: SpendMode = sp.spend === "cash" ? "cash" : "accrual";
  const value: ValueMode = sp.value === "nominal" ? "nominal" : sp.value === "usd" ? "usd" : "real";
  const tax: TaxMode = sp.tax === "incl" ? "incl" : "excl";
  return { spend, value, tax };
}

export function withModes(
  path: string,
  modes: Record<string, string>,
  extra: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ ...modes, ...extra });
  return `${path}?${q.toString()}`;
}

/** The period labels a set of cycle months collapses to, oldest first, each one once. */
export function periodsFor(months: readonly string[], g: Granularity): string[] {
  return [...new Set(months.map(m => periodOf(m, g)))];
}

/** Where a page lands when its `period` param names no period this granularity has. */
export type PeriodMode = "latest" | "all-first";

/**
 * The selected period. A label from another granularity is not valid here, so switching
 * granularity falls back rather than scoping the page to a bucket that does not exist — to the
 * newest period, or to the whole history on the pages that default to it.
 */
export function resolvePeriod(periods: readonly string[], raw: unknown, mode: PeriodMode): string {
  if (typeof raw === "string" && periods.includes(raw)) return raw;
  return mode === "all-first" ? ALL_PERIOD : periods.at(-1) ?? "";
}
```

- [ ] **Step 4: Reduce params.ts to its server-only half**

Replace `web/src/lib/params.ts` with:

```ts
import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import type { Modes } from "@/lib/scope";
import type { ValueOpts } from "@/lib/queries";

// The scope helpers live in @/lib/scope, which is pure and therefore safe in a client
// component. They are re-exported here so the pages that already import them do not care.
export {
  GRANULARITIES, MOVER_GRANULARITIES, parseGranularity, granularityLabel, periodWord, spanLabel,
  parseModes, withModes, periodsFor, resolvePeriod,
} from "@/lib/scope";
export type { SP, Modes, PeriodMode } from "@/lib/scope";

// Server-only: the single place a page assembles ValueOpts. Both tables are module-cached.
// Keep this file out of "use client" components — loadCpi/loadMep read the filesystem.
export function valueOpts(modes: Modes): ValueOpts {
  return { ...modes, cpi: loadCpi(), mep: loadMep() };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd web && npm test -- scope
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

```bash
cd web && npm test && npx tsc --noEmit
```

Expected: every suite passes (`params.test.ts` included — it imports through the re-export), no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/scope.ts web/src/lib/scope.test.ts web/src/lib/params.ts && git commit -m "refactor(lib): split the pure scope helpers out of params"
```

---

### Task 2: The one read the layout does

The chrome needs three facts before it knows which page it is on: every cycle month on file (the period picker's options), the newest closing date (the overview title names it), and the base month for real values. The first two come from one query; the third is `latestMonth(loadCpi())`.

**Files:**
- Modify: `web/src/lib/queries.ts`
- Test: `web/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `Database` from better-sqlite3, `coverage` from this same module.
- Produces: `chromeData(db: Database.Database): { months: string[]; latestClosing: string | null }`.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/queries.test.ts`, add `chromeData` to the existing import list from `@/lib/queries`, then add inside the `describe("queries", ...)` block:

```ts
  it("chromeData returns the months on file and the newest closing date", () => {
    expect(chromeData(db)).toEqual({ months: ["2026-06", "2026-07"], latestClosing: "2026-07-30" });
  });

  // The layout renders chrome before anything is ingested, so this read must survive an empty
  // database rather than taking every route down with it — /upload above all.
  it("chromeData survives an empty database", () => {
    expect(chromeData(openDb(":memory:"))).toEqual({ months: [], latestClosing: null });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- queries
```

Expected: FAIL — `chromeData is not a function` (the named import is undefined).

- [ ] **Step 3: Add the query**

In `web/src/lib/queries.ts`, directly after the `coverage` function, add:

```ts
/**
 * What the page chrome needs before it knows which page it is: the cycle months on file, which
 * are the period picker's options, and the newest closing date, which the overview title names.
 * One read, done by the layout, shared by every route.
 */
export function chromeData(db: Database.Database): { months: string[]; latestClosing: string | null } {
  const latest = db.prepare("SELECT MAX(closing_date) AS d FROM statements").get() as { d: string | null };
  return { months: coverage(db).map(c => c.month), latestClosing: latest.d };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm test -- queries
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/queries.ts web/src/lib/queries.test.ts && git commit -m "feat(queries): chromeData, the layout's one statement read"
```

---

### Task 3: The chrome table and the header component

The table is the whole design: one row per route, saying what its header holds. The component reads the row for the current path and renders it. Neither is wired into the layout yet, so this commit changes nothing on screen — it is reviewable on its own, and the route-coverage test already passes.

**Files:**
- Create: `web/src/lib/chrome.ts`, `web/src/lib/chrome.test.ts`, `web/src/components/PageChrome.tsx`
- Test: `web/src/lib/chrome.test.ts`

**Interfaces:**
- Consumes: `MessageKey`, `Translator` from `@/lib/i18n`; `ALL_PERIOD`, `Granularity` from `@/lib/months`; `GRANULARITIES`, `MOVER_GRANULARITIES`, `PeriodMode`, `parseGranularity`, `parseModes`, `periodsFor`, `resolvePeriod`, `granularityLabel` from `@/lib/scope`; `ModeToggle`, `Pills`, `useT`.
- Produces:
  - `type RouteChrome = { title: MessageKey; titleVars?: (ctx: { latestClosing: string | null; period: string; t: Translator }) => Record<string, string>; toggles?: { spend?: false; tax?: false }; basisCaption?: true; granularities?: readonly Granularity[]; period?: PeriodMode }`
  - `const CHROME: Record<string, RouteChrome>`
  - `PageChrome({ months, latestClosing, baseMonth }: { months: readonly string[]; latestClosing: string | null; baseMonth: string }): JSX.Element | null` from `@/components/PageChrome`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/chrome.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { CHROME } from "@/lib/chrome";
import { DICTIONARIES, DEFAULT_LOCALE } from "@/lib/i18n";

const APP = path.resolve(__dirname, "../app");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

const PAGES = pageFiles(APP).map(file => {
  const dir = path.dirname(path.relative(APP, file));
  return { route: dir === "." ? "/" : `/${dir}`, src: readFileSync(file, "utf8") };
});

describe("route chrome", () => {
  it("finds the routes", () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(20);
  });

  // A page with no row renders no header at all, and a row with no page is dead weight. Making
  // this an equality is the whole point of the table: adding a route without deciding what its
  // header holds fails here rather than shipping a page with no title.
  it("has exactly one entry per route", () => {
    expect(Object.keys(CHROME).sort()).toEqual(PAGES.map(p => p.route).sort());
  });

  it("names a title key that exists", () => {
    for (const [route, entry] of Object.entries(CHROME)) {
      expect(Object.keys(DICTIONARIES[DEFAULT_LOCALE]), route).toContain(entry.title);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- chrome
```

Expected: FAIL — `Failed to resolve import "@/lib/chrome"`.

- [ ] **Step 3: Write the chrome table**

Create `web/src/lib/chrome.ts`:

```ts
import type { MessageKey, Translator } from "@/lib/i18n";
import { ALL_PERIOD, type Granularity } from "@/lib/months";
import { GRANULARITIES, MOVER_GRANULARITIES, type PeriodMode } from "@/lib/scope";

/**
 * What one route's header holds. Everything here is either a constant or derivable from the
 * URL, which is why the header can live in the layout instead of in twenty-two pages.
 */
export type RouteChrome = {
  /** The page title. */
  title: MessageKey;
  /** For the two titles that name something the chrome already knows. */
  titleVars?: (ctx: { latestClosing: string | null; period: string; t: Translator }) => Record<string, string>;
  /** Which mode toggles this page answers to. Omitted means it has none. */
  toggles?: { spend?: false; tax?: false };
  /** For a page with no toggles that still has to state which pesos it is speaking. */
  basisCaption?: true;
  /** The granularity pills, where the page is a time series. */
  granularities?: readonly Granularity[];
  /** The period picker, and where it lands when the param names no period this granularity has. */
  period?: PeriodMode;
};

export const CHROME: Record<string, RouteChrome> = {
  "/": {
    title: "overview.title",
    titleVars: ({ latestClosing }) => ({ date: latestClosing ?? "—" }),
    toggles: {},
  },
  "/anomalies": {
    title: "anomalies.title",
    toggles: {},
    // Granularity moves the timeline only: the table below is a list of alerts, not a time
    // series, so grouping it would hide the very rows that page exists to show.
    granularities: GRANULARITIES,
  },
  "/bank": {
    title: "bank.title",
    // Spend/tax toggles hidden: limits, balances and rates are statement-header facts — no
    // purchase-level accounting view applies to them.
    toggles: { spend: false, tax: false },
  },
  "/calendar": {
    title: "calendar.title",
    // No spend toggle: a calendar is always about purchase days, so this page forces accrual.
    toggles: { spend: false },
  },
  "/categories": {
    title: "categories.title",
    toggles: {},
    granularities: GRANULARITIES,
    period: "latest",
  },
  "/compare": { title: "compare.title", toggles: {}, granularities: GRANULARITIES },
  "/credits": {
    title: "credits.title",
    // spend toggle hidden: credits are billed lines, cash by nature; tax toggle: a credit is not taxed
    toggles: { spend: false, tax: false },
    granularities: GRANULARITIES,
  },
  "/currency": { title: "currency.title", toggles: {}, granularities: GRANULARITIES },
  "/float": {
    title: "float.title",
    // No mode toggles: the float gain is a real-terms quantity by construction (see
    // paymentFloat), so the page states its basis rather than offering a choice.
    basisCaption: true,
    granularities: GRANULARITIES,
  },
  "/future": { title: "future.title", toggles: {} },
  "/habits": {
    title: "habits.title",
    // spend toggle hidden: both charts collapse installment series to their purchase day
    toggles: { spend: false },
    // No granularity row: this page's `g` scopes its ticket chart alone, so those pills stay
    // beside that chart where they cannot be read as controlling the weekday one too.
  },
  "/inflation": { title: "inflation.title" },
  "/installments": {
    title: "installments.title",
    // spend toggle hidden: this page is cash by definition — see installmentBurden
    toggles: { spend: false },
    granularities: GRANULARITIES,
  },
  "/merchants": {
    title: "merchants.title",
    toggles: {},
    granularities: GRANULARITIES,
    // The whole history is this page's default scope, and its first pill.
    period: "all-first",
  },
  "/movers": { title: "movers.title", toggles: {}, granularities: MOVER_GRANULARITIES },
  "/pace": {
    title: "pace.title",
    // Spend toggle hidden: pace is purchase decisions made inside the cycle window, which is
    // the accrual reading by construction.
    toggles: { spend: false },
  },
  "/recurring": { title: "recurring.title" },
  "/review": { title: "review.title" },
  "/sankey": {
    title: "sankey.title",
    titleVars: ({ period, t }) => ({ period: period === ALL_PERIOD ? t("sankey.everything") : period }),
    toggles: {},
    granularities: GRANULARITIES,
    period: "latest",
  },
  "/taxes": {
    title: "taxes.title",
    // tax toggle hidden: this page IS the tax view — "true cost" would double-count
    toggles: { spend: false, tax: false },
    granularities: GRANULARITIES,
  },
  "/trends": { title: "trends.title", toggles: {}, granularities: GRANULARITIES },
  "/upload": { title: "upload.title" },
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm test -- chrome
```

Expected: PASS, 3 tests. If "has exactly one entry per route" fails, the table and the filesystem disagree — fix the table, not the test.

- [ ] **Step 5: Write the header component**

Create `web/src/components/PageChrome.tsx`:

```tsx
"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { CHROME } from "@/lib/chrome";
import { ALL_PERIOD, type Granularity } from "@/lib/months";
import { granularityLabel, parseGranularity, parseModes, periodsFor, resolvePeriod } from "@/lib/scope";
import { useT } from "./I18nProvider";
import { ModeToggle } from "./ModeToggle";
import { Pills } from "./Pills";

/**
 * The top of every page — title, mode toggles, filter pills — rendered by the root layout and
 * not by the pages. Both rows have reserved heights, and a route with nothing to put in a slot
 * leaves it empty rather than pulling the rest up, so the three land on the same pixel row
 * everywhere. A page cannot move them because a page does not render them.
 *
 * A client component because it is driven entirely by the URL: `useSearchParams` re-renders it
 * on every toggle, which a server layout would not do.
 */
export function PageChrome({ months, latestClosing, baseMonth }: {
  /** Every cycle month on file, oldest first — the period picker's raw material. */
  months: readonly string[];
  /** Newest statement closing date, or null before anything is ingested. */
  latestClosing: string | null;
  /** The month real values are expressed in. The same on every page. */
  baseMonth: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useT();
  const chrome = CHROME[pathname];
  // A route with no row gets no header rather than a crash. chrome.test.ts makes sure no page
  // ends up here by accident.
  if (!chrome) return null;

  const query = Object.fromEntries(sp.entries());
  const g = parseGranularity(query);
  const periods = periodsFor(months, g);
  const period = resolvePeriod(periods, query.period, chrome.period ?? "latest");

  // Every page builds its filter links the same way, so the chrome builds them once: changing
  // granularity drops `period`, because a month label is not a valid year; changing period keeps
  // everything. Both preserve whatever else is in the URL, which is how /categories keeps the
  // category you drilled into.
  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) q.delete(key); else q.set(key, value);
    }
    const rest = q.toString();
    return rest ? `${pathname}?${rest}` : pathname;
  };

  return (
    <header className="mb-6">
      {/* min-h, not h: 2rem clears both the 1.75rem title line box and the 1.875rem toggle box,
          and still lets the toggles wrap onto a second line on a phone — where nothing is being
          compared between routes anyway. */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">
          {t(chrome.title, chrome.titleVars?.({ latestClosing, period, t }))}
        </h1>
        {chrome.toggles && (
          <ModeToggle
            modes={parseModes(query)}
            baseMonth={baseMonth}
            spendToggle={chrome.toggles.spend !== false}
            taxToggle={chrome.toggles.tax !== false}
          />
        )}
        {chrome.basisCaption && (
          <span className="text-xs text-ink-subtle">{t("mode.inPesos", { month: baseMonth })}</span>
        )}
      </div>
      {/* One line, always. It scrolls sideways rather than wrapping: a period row is as long as
          the statement history, and a second line would push the whole page down. The height is
          fixed rather than fitted so the focus ring has room and an empty row still holds it. */}
      <div className="mt-3 flex h-9 items-center gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chrome.granularities && (
          <Pills
            options={chrome.granularities}
            current={g}
            href={x => href({ g: x, period: undefined })}
            label={x => granularityLabel(x as Granularity, t.locale)}
          />
        )}
        {/* At "all" granularity every month is already one bucket, so the picker would offer
            "all" and nothing else — the granularity pill has said it. */}
        {chrome.period && g !== "all" && (
          <Pills
            options={chrome.period === "all-first" ? [ALL_PERIOD, ...periods] : periods}
            current={period}
            href={p => href({ period: p === ALL_PERIOD ? undefined : p })}
            label={p => (p === ALL_PERIOD ? granularityLabel("all", t.locale) : p)}
          />
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/chrome.ts web/src/lib/chrome.test.ts web/src/components/PageChrome.tsx && git commit -m "feat(ui): one table describing every route's header, and the header that reads it"
```

---

### Task 4: Wire the layout and delete every page header

The layout starts rendering the chrome and the pages stop rendering theirs, in one commit — either half alone would leave every page with two titles or none.

Nearly all of this is deletion. Three pages (`/categories`, `/merchants`, `/sankey`) also swap their inline period resolution for the shared functions from Task 1, so the page and the chrome can never disagree about which period is selected.

**Files:**
- Modify: `web/src/app/layout.tsx`, `web/src/components/Pills.tsx`, `web/src/app/globals.css`
- Modify: all twenty-two `web/src/app/**/page.tsx`
- Test: `web/src/lib/chrome.test.ts`

**Interfaces:**
- Consumes: `PageChrome` (Task 3), `chromeData` (Task 2), `periodsFor`/`resolvePeriod` (Task 1).
- Produces: no new exports. After this task no `page.tsx` contains an `<h1>`, a `<ModeToggle>`, or a page-wide `<Pills>`.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/chrome.test.ts`, add to the `describe("route chrome", ...)` block:

```ts
  // The header is the layout's, not the page's. A page that renders its own title puts it
  // wherever its own markup lands, which is the bug this table exists to make impossible.
  it("leaves the header entirely to the layout", () => {
    for (const { route, src } of PAGES) {
      expect(src, route).not.toContain("<h1");
      expect(src, route).not.toContain("<ModeToggle");
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- chrome
```

Expected: FAIL — `expected '...' not to contain "<h1"` for `/` and twenty-one more.

- [ ] **Step 3: Render the chrome from the layout**

In `web/src/app/layout.tsx`, add these imports:

```tsx
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { chromeData } from "@/lib/queries";
import { PageChrome } from "@/components/PageChrome";
```

Inside `RootLayout`, after `const locale = await getLocale();`, add:

```tsx
  // The three facts the header needs before it knows which page it is. Cheap, and the same for
  // every route — which is the reason the header can live up here at all. `cookies()` in
  // getLocale already makes this layout dynamic, so these are read per request.
  const { months, latestClosing } = chromeData(getDb());
  const baseMonth = latestMonth(loadCpi());
```

Then replace:

```tsx
              <div className="mx-auto w-full max-w-[150rem]">{children}</div>
```

with:

```tsx
              <div className="mx-auto w-full max-w-[150rem]">
                <Suspense>
                  <PageChrome months={months} latestClosing={latestClosing} baseMonth={baseMonth} />
                </Suspense>
                {children}
              </div>
```

- [ ] **Step 4: Make Pills layout-neutral**

Replace `web/src/components/Pills.tsx` with:

```tsx
import Link from "next/link";

// A row of link pills — the granularity and period pickers. Layout-neutral on purpose: the
// caller owns the spacing, because in the page chrome this row is one line of a fixed-height
// filter bar that must not wrap.
export function Pills({ options, current, href, label }: {
  options: readonly string[];
  current: string;
  href: (option: string) => string;
  /** Display text for an option. Period rows are dates and pass nothing; granularity rows translate. */
  label?: (option: string) => string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-sm">
      {options.map(x => (
        <Link
          key={x}
          href={href(x)}
          className={`whitespace-nowrap rounded-md px-2 py-0.5 transition-colors ${
            x === current
              ? "bg-accent text-accent-ink font-medium"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {label ? label(x) : x}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Reserve the scrollbar column**

In `web/src/app/globals.css`, directly after the `body { ... }` rule, add:

```css
/* The content column must not shift sideways between a short route and a long one: reserve the
   scrollbar's width whether or not this page happens to overflow. */
html {
  scrollbar-gutter: stable;
}
```

- [ ] **Step 6: Strip / (overview)**

In `web/src/app/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("overview.title", { date: t.latestClosing })}</h1>
        <ModeToggle modes={modes} baseMonth={t.baseMonth} />
      </div>
```

- [ ] **Step 7: Strip /anomalies**

In `web/src/app/anomalies/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("anomalies.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
```

and delete:

```tsx
      {/* Granularity moves the timeline only: the table below is a list of alerts, not a
          time series, so grouping it would hide the very rows this page exists to show. */}
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/anomalies", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

The summary paragraph stays and becomes the page's first element.

- [ ] **Step 8: Strip /trends**

In `web/src/app/trends/page.tsx`, delete:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("trends.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/trends", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 9: Strip /compare**

In `web/src/app/compare/page.tsx`, delete:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("compare.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/compare", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 10: Strip /currency**

In `web/src/app/currency/page.tsx`, delete:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("currency.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/currency", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 11: Strip /taxes**

In `web/src/app/taxes/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("taxes.title")}</h1>
        {/* tax toggle hidden: this page IS the tax view — "true cost" would double-count */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/taxes", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 12: Strip /credits**

In `web/src/app/credits/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("credits.title")}</h1>
        {/* spend toggle hidden: credits are billed lines, cash by nature; tax toggle: a credit is not taxed */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/credits", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 13: Strip /installments**

In `web/src/app/installments/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("installments.title")}</h1>
        {/* spend toggle hidden: this page is cash by definition — see installmentBurden */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/installments", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

- [ ] **Step 14: Strip /movers**

In `web/src/app/movers/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("movers.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>

      <Pills
        options={MOVER_GRANULARITIES} current={g}
        href={x => withModes("/movers", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

Also delete its local constant, which now lives in `@/lib/scope`:

```tsx
const MOVER_GRANULARITIES = ["month", "quarter", "year"] as const;
```

- [ ] **Step 15: Strip /float**

In `web/src/app/float/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("float.title")}</h1>
        <span className="text-xs text-ink-subtle">{tr("mode.inPesos", { month: base })}</span>
      </div>

      <Pills
        options={GRANULARITIES} current={g} href={x => `/float?g=${x}`}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
```

and the line that fed the caption, now unused:

```tsx
  const base = latestMonth(cpi);
```

- [ ] **Step 16: Strip /sankey and share its period resolution**

In `web/src/app/sankey/page.tsx`, replace:

```tsx
  // coverage() is already in month order, so collapsing to period labels keeps them chronological.
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  // A label from another granularity is not valid here, so switching granularity falls back to
  // the newest period rather than drawing an empty flow.
  const period = typeof sp.period === "string" && periods.includes(sp.period)
    ? sp.period
    : periods.at(-1) ?? "";
```

with:

```tsx
  // The same two functions the chrome uses, so the page and its period pills can never disagree
  // about which period is selected.
  const period = resolvePeriod(periodsFor(coverage(db).map(c => c.month), g), sp.period, "latest");
```

Add `periodsFor, resolvePeriod` to the existing `@/lib/params` import. Then delete:

```tsx
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">
          {tr("sankey.title", { period: period === "all" ? tr("sankey.everything") : period })}
        </h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/sankey", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {g !== "all" && (
        <Pills options={periods} current={period} href={p => withModes("/sankey", modes, { g, period: p })} />
      )}
```

- [ ] **Step 17: Strip /categories and share its period resolution**

In `web/src/app/categories/page.tsx`, replace:

```tsx
  // coverage() comes back ordered by cycle month, so collapsing to period labels keeps them
  // chronological without a second sort — and dedupes the months sharing a quarter or year.
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  const period = typeof sp.period === "string" && periods.includes(sp.period)
    ? sp.period
    : periods.at(-1) ?? "";
```

with:

```tsx
  // The same two functions the chrome uses, so the page and its period pills can never disagree
  // about which period is selected.
  const period = resolvePeriod(periodsFor(coverage(db).map(c => c.month), g), sp.period, "latest");
```

Add `periodsFor, resolvePeriod` to the existing `@/lib/params` import. Then delete the two link builders the chrome now owns:

```tsx
  // The granularity links deliberately omit `period`: a month label is not a valid year, so
  // the new granularity re-defaults to its newest period rather than falling back to all-time.
  const granularityHref = (x: Granularity) => withModes("/categories", modes, { g: x, ...drilled });
  const periodHref = (p: string) => withModes("/categories", modes, { g, period: p, ...drilled });
```

and delete:

```tsx
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("categories.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g} href={x => granularityHref(x as Granularity)}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {/* One bucket at "all" granularity — a period picker with a single choice is noise. */}
      {g !== "all" && <Pills options={periods} current={period} href={periodHref} />}
```

Keep `drilled` and `crumbHref` — the breadcrumb still uses both.

- [ ] **Step 18: Strip /merchants and share its period resolution**

In `web/src/app/merchants/page.tsx`, replace:

```tsx
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  // ALL_PERIOD is the default and the fallback for a period label from another granularity —
  // switching granularity deliberately drops `period` back to the full history.
  const period = typeof sp.period === "string" && periods.includes(sp.period) ? sp.period : ALL_PERIOD;
```

with:

```tsx
  // The same two functions the chrome uses, so the page and its period pills can never disagree
  // about which period is selected. ALL_PERIOD is both this page's default and its fallback.
  const period = resolvePeriod(periodsFor(coverage(db).map(c => c.month), g), sp.period, "all-first");
```

Add `periodsFor, resolvePeriod` to the existing `@/lib/params` import. Then delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("merchants.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/merchants", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {/* At "all" granularity every month is already one bucket, so the scope row would offer
          "all" and nothing else — the granularity pill has said it. */}
      {g !== "all" && (
        <Pills
          options={[ALL_PERIOD, ...periods]}
          current={period}
          href={p => withModes("/merchants", modes, p === ALL_PERIOD ? { g } : { g, period: p })}
          label={p => (p === ALL_PERIOD ? granularityLabel("all", tr.locale) : p)}
        />
      )}
```

`ALL_PERIOD` is still used further down the file — keep that import.

- [ ] **Step 19: Strip /bank**

In `web/src/app/bank/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("bank.title")}</h1>
        {/* Spend/tax toggles hidden: limits, balances and rates are statement-header facts —
            no purchase-level accounting view applies to them. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>
```

- [ ] **Step 20: Strip /calendar**

In `web/src/app/calendar/page.tsx`, delete:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("calendar.title")}</h1>
        {/* No spend toggle: a calendar is always about purchase days, so this page forces accrual. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
```

- [ ] **Step 21: Strip /future**

In `web/src/app/future/page.tsx`, delete:

```tsx
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("future.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
```

- [ ] **Step 22: Strip /pace**

In `web/src/app/pace/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("pace.title")}</h1>
        {/* Spend toggle hidden: pace is purchase decisions made inside the cycle window, which
            is the accrual reading by construction. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
```

- [ ] **Step 23: Strip /habits and keep its section pills**

In `web/src/app/habits/page.tsx`, delete:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("habits.title")}</h1>
        {/* spend toggle hidden: both charts collapse installment series to their purchase day */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
```

`Pills` no longer carries its own margin, and this page's pills sit inside a chart section rather than in the chrome. Replace:

```tsx
            <Pills
              options={GRANULARITIES} current={g}
              href={x => withModes("/habits", modes, { g: x })}
              label={x => granularityLabel(x as Granularity, tr.locale)}
            />
```

with:

```tsx
            {/* Scoped to this chart, not the page — so it stays here rather than in the chrome,
                and owns its own spacing the way any section-level control does. */}
            <div className="mb-4">
              <Pills
                options={GRANULARITIES} current={g}
                href={x => withModes("/habits", modes, { g: x })}
                label={x => granularityLabel(x as Granularity, tr.locale)}
              />
            </div>
```

- [ ] **Step 24: Strip /inflation, /review, /upload and /recurring**

Four single-line deletions. In `web/src/app/inflation/page.tsx`:

```tsx
      <h1 className="text-xl font-semibold mb-2">{tr("inflation.title")}</h1>
```

In `web/src/app/review/page.tsx`:

```tsx
      <h1 className="mb-2 text-xl font-semibold">{tr("review.title")}</h1>
```

In `web/src/app/upload/page.tsx`:

```tsx
      <h1 className="mb-4 text-xl font-semibold">{tr("upload.title")}</h1>
```

In `web/src/app/recurring/page.tsx`:

```tsx
        <h1 className="text-xl font-semibold mb-4">{tr("recurring.title")}</h1>
```

Leave the surrounding `<main>`, `<div>` and `<section>` wrappers alone — the chrome sits above `<main>`, so nothing needs re-nesting.

- [ ] **Step 25: Sweep the imports the deletions orphaned**

`tsc` will not flag these: there is no linter and `noUnusedLocals` is off. Run:

```bash
cd web && for f in $(find src/app -name page.tsx); do for n in ModeToggle Pills latestMonth withModes granularityLabel GRANULARITIES MOVER_GRANULARITIES coverage periodOf Granularity ALL_PERIOD; do if grep -q "^import.*\b$n\b" "$f" && [ "$(grep -c "\b$n\b" "$f")" = "1" ]; then echo "$f: $n"; fi; done; done
```

Every name it prints appears only on its own import line. Delete each one from that file's imports, and delete any import statement left with nothing in it. Re-run until it prints nothing.

- [ ] **Step 26: Run the test to verify it passes**

```bash
cd web && npm test -- chrome
```

Expected: PASS, 4 tests.

- [ ] **Step 27: Run the whole suite and typecheck**

```bash
cd web && npm test && npx tsc --noEmit
```

Expected: every suite passes, no type errors.

- [ ] **Step 28: Verify in the browser**

Open the preview (`preview_start` with `{name: "tarjetas-web"}` — reuse the server already on port 3000). Check `/`, `/trends`, `/categories`, `/merchants`, `/sankey`, `/float`, `/upload`: each shows exactly one title, the right toggles, and the right pills. Then read the console with `read_console_messages` and `onlyErrors: true`. Expected: nothing. In particular no "useSearchParams should be wrapped in a suspense boundary" — if that appears, the `<Suspense>` in Step 3 is missing or misplaced.

- [ ] **Step 29: Commit**

```bash
git add -A web/src && git commit -m "refactor(ui): the layout renders the page header, not the pages"
```

---

### Task 5: Measure every route

The tests prove the header comes from one place. Only the browser proves the pixels line up. This task measures all twenty-two routes and fixes whatever drifts; if nothing drifts, it commits nothing and says so.

**Files:**
- Modify: only whatever the measurement turns up.
- Test: the measurement below.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: an accepted set of measurements — one title top, one filter-bar top, one filter-bar height, shared by every route.

- [ ] **Step 1: Open the preview**

`preview_start` with `{name: "tarjetas-web"}`. Reuse the server on port 3000. Set the viewport once and leave it fixed for the whole task — the numbers only compare at one width.

- [ ] **Step 2: Measure each route**

For each of `/`, `/anomalies`, `/trends`, `/categories`, `/merchants`, `/movers`, `/compare`, `/sankey`, `/calendar`, `/habits`, `/pace`, `/recurring`, `/currency`, `/inflation`, `/taxes`, `/credits`, `/float`, `/future`, `/installments`, `/bank`, `/upload`, `/review`: navigate, then run

```js
JSON.stringify((() => {
  window.scrollTo(0, 0);
  const header = document.querySelector("header");
  const h1 = header.querySelector("h1").getBoundingClientRect();
  const bar = header.lastElementChild.getBoundingClientRect();
  const body = document.querySelector("main").getBoundingClientRect();
  return {
    path: location.pathname,
    title: Math.round(h1.top),
    bar: Math.round(bar.top),
    barHeight: Math.round(bar.height),
    main: Math.round(body.top),
  };
})())
```

Collect all twenty-two results into one table.

Expected: `title`, `bar`, `barHeight` and `main` identical on every route. `barHeight` is 36.

- [ ] **Step 3: Check the same-route cases**

On `/categories`, `/merchants` and `/sankey`, measure `?g=month` and then `?g=all` (the period row disappears). On `/categories` also measure a drilled URL such as `?g=month&category=food`, which adds the breadcrumb row.

Expected: `title`, `bar`, `barHeight` and `main` unchanged in every case. Content below the breadcrumb may move on the drilled URL — the breadcrumb is out of scope.

- [ ] **Step 4: Check the long period row**

On `/merchants?g=month`, with a history long enough to overflow the row:

```js
JSON.stringify((() => {
  const bar = document.querySelector("header").lastElementChild;
  return { height: Math.round(bar.getBoundingClientRect().height), scrollable: bar.scrollWidth > bar.clientWidth };
})())
```

Expected: `height` is 36 whether or not `scrollable` is true — the row scrolls, it never wraps.

- [ ] **Step 5: Check that the chrome survives a mode change without a reload**

On `/trends`, click a value-mode toggle and re-run the Step 2 snippet.

Expected: identical numbers, and the granularity pills still highlight the same option. This is what proves the client component is re-reading the URL rather than holding a stale render.

- [ ] **Step 6: Check the dark scheme and a narrow window**

Re-measure `/trends` and `/bank` with `colorScheme: "dark"`, then at the `mobile` preset. Dark must not change any number. At mobile the toggles may wrap — that is allowed by design; what must still hold is that `/trends` and `/bank` agree with each other.

- [ ] **Step 7: Fix any drift**

If a route disagrees, the cause is something left at the top of that page's `<main>` — a stray `mb-*`/`mt-*` on what is now the first element. Fix it in the page file, not in `PageChrome`: the component's heights are the contract. Re-run Step 2 for the routes you touched.

- [ ] **Step 8: Take the proof screenshot**

Screenshot `/trends` and `/bank` at the same viewport and confirm by eye that the title and the toggles sit on the same line in both.

- [ ] **Step 9: Commit, only if Step 7 changed something**

```bash
git add -A web/src/app && git commit -m "fix(ui): drop the stray margins that pushed a page off the shared row"
```

If Step 7 changed nothing, commit nothing and report the measured table instead.

---

## Acceptance

- No `web/src/app/**/page.tsx` contains an `<h1>` or a `<ModeToggle>`; the header comes from the layout on every route.
- `CHROME` has exactly one entry per route, enforced by `chrome.test.ts`.
- `npm test` and `npx tsc --noEmit` pass.
- Measured at one desktop viewport, all twenty-two routes report the same title top, the same filter-bar top, a 36px filter bar, and the same `main` top.
- Switching granularity on `/categories`, `/merchants` and `/sankey` moves nothing above the content.
- Changing a mode toggle re-renders the pills without moving them.
