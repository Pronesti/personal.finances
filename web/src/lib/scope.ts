import { ALL_PERIOD, periodOf, type Granularity } from "@/lib/months";
import { DEFAULT_LOCALE, translate, type Locale } from "@/lib/i18n";
import type { SpendMode, TaxMode, ValueMode } from "@/lib/queries";

// Everything here is pure: it reads the URL and the months on file and nothing else. That is
// what lets the page chrome — a client component — share it with the server pages, which
// @/lib/params cannot do because it also opens the CPI and MEP tables off disk.

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
