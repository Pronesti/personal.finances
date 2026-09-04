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
  "/receipts": { title: "receipts.title" },
  // The dynamic segment is the route as chrome.test derives it from the directory name.
  "/receipts/[id]": { title: "receipts.detail.title" },
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
