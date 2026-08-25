import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
import { monthValue } from "@/lib/cpi";

export type MepTable = Record<string, number>; // "YYYY-MM" -> ARS per USD (monthly mean of MEP sell)

export function mepFor(month: string, table: MepTable): number {
  return monthValue(month, table, "npm run fetch-mep");
}

let _mep: MepTable | undefined;
export function loadMep(): MepTable {
  if (_mep) return _mep;
  const p = path.join(DATA_DIR, "mep.json");
  if (!fs.existsSync(p)) throw new Error("data/mep.json missing — run npm run fetch-mep");
  return (_mep = JSON.parse(fs.readFileSync(p, "utf8")) as MepTable);
}
