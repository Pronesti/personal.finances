import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import type { Granularity } from "@/lib/months";
import type { SpendMode, TaxMode, ValueMode, ValueOpts } from "@/lib/queries";

type SP = { [k: string]: string | string[] | undefined };

export const GRANULARITIES = ["month", "quarter", "year"] as const;

export function parseGranularity(sp: SP): Granularity {
  return sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
}

export type Modes = { spend: SpendMode; value: ValueMode; tax: TaxMode };

export function parseModes(sp: SP): Modes {
  const spend: SpendMode = sp.spend === "cash" ? "cash" : "accrual";
  const value: ValueMode = sp.value === "nominal" ? "nominal" : sp.value === "usd" ? "usd" : "real";
  const tax: TaxMode = sp.tax === "incl" ? "incl" : "excl";
  return { spend, value, tax };
}

// Server-only: the single place a page assembles ValueOpts. Both tables are module-cached.
// Keep this file out of "use client" components — loadCpi/loadMep read the filesystem.
export function valueOpts(modes: Modes): ValueOpts {
  return { ...modes, cpi: loadCpi(), mep: loadMep() };
}

export function withModes(
  path: string,
  modes: Record<string, string>,
  extra: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ ...modes, ...extra });
  return `${path}?${q.toString()}`;
}
