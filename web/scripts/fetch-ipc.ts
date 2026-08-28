import fs from "node:fs";
import path from "node:path";

const SERIES_ID = "148.3_INIVELNAL_DICI_M_26"; // IPC nivel general, nacional, índice
const URL = `https://apis.datos.gob.ar/series/api/series/?ids=${SERIES_ID}&limit=5000&format=json&start_date=2024-01-01`;

async function main() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`datos.gob.ar ${res.status}`);
  const body = await res.json();
  const table: Record<string, number> = {};
  for (const [date, value] of body.data as [string, number][]) {
    if (value != null) table[date.slice(0, 7)] = value;
  }
  if (Object.keys(table).length === 0) throw new Error("empty series — check SERIES_ID");
  const out = path.resolve(process.cwd(), "..", "data", "ipc.json");
  fs.writeFileSync(out, JSON.stringify(table, null, 1));
  console.log("wrote", out, Object.keys(table).length, "months, latest:", Object.keys(table).sort().at(-1));
}
main().catch(e => { console.error(e); process.exit(1); });
