import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export type CpiTable = Record<string, number>;

function indexFor(month: string, table: CpiTable): number {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error("CPI table empty — run npm run fetch-ipc");
  if (table[month] !== undefined) return table[month];
  const earlier = months.filter(m => m < month);
  if (earlier.length === 0) throw new Error(`No CPI data at or before ${month}`);
  return table[earlier[earlier.length - 1]];
}

export function toReal(amountArs: number, fromMonth: string, toMonth: string, table: CpiTable): number {
  return amountArs * (indexFor(toMonth, table) / indexFor(fromMonth, table));
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
