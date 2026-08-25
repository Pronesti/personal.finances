import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
import { monthsBetween } from "@/lib/months";

export type CpiTable = Record<string, number>;

export const CPI_REMEDY = "npm run fetch-ipc";

// Shared by CPI and MEP: exact month, else nearest earlier month. `remedy` is the command
// the user must run, so an empty or short table produces an actionable error, not a NaN.
export function monthValue(month: string, table: Record<string, number>, remedy: string): number {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error(`table empty — run ${remedy}`);
  if (table[month] !== undefined) return table[month];
  const earlier = months.filter(m => m < month);
  if (earlier.length === 0) throw new Error(`No data at or before ${month} — run ${remedy}`);
  return table[earlier[earlier.length - 1]];
}

export function toReal(amountArs: number, fromMonth: string, toMonth: string, table: CpiTable): number {
  return amountArs * (monthValue(toMonth, table, CPI_REMEDY) / monthValue(fromMonth, table, CPI_REMEDY));
}

export function latestMonth(table: CpiTable): string {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error("CPI table empty — run npm run fetch-ipc");
  return months[months.length - 1];
}

let _cpi: CpiTable | undefined;
export function loadCpi(): CpiTable {
  if (_cpi) return _cpi;
  const p = path.join(DATA_DIR, "ipc.json");
  if (!fs.existsSync(p)) throw new Error("data/ipc.json missing — run npm run fetch-ipc");
  return (_cpi = JSON.parse(fs.readFileSync(p, "utf8")) as CpiTable);
}

// Geometric mean monthly inflation over the trailing window — the rate projections grow by.
export function trailingMonthlyInflation(table: CpiTable, n = 6): number {
  const months = Object.keys(table).sort();
  if (months.length < 2) throw new Error(`CPI table too short — run ${CPI_REMEDY}`);
  const last = months[months.length - 1];
  const first = months[Math.max(0, months.length - 1 - n)];
  const periods = monthsBetween(first, last) - 1; // inclusive span minus one = elapsed months
  return Math.pow(table[last] / table[first], 1 / periods) - 1;
}
