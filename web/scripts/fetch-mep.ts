import fs from "node:fs";
import path from "node:path";

const URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa";

type Quote = { casa: string; compra: number | null; venta: number | null; fecha: string };

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`argentinadatos.com ${res.status} for ${URL}`);
  const rows = (await res.json()) as Quote[];
  // Monthly mean of the sell rate — every aggregate in this app is keyed by cycle month.
  const sums = new Map<string, { total: number; n: number }>();
  for (const q of rows) {
    if (q.venta == null || q.fecha < "2024-01-01") continue;
    const m = q.fecha.slice(0, 7);
    const acc = sums.get(m) ?? { total: 0, n: 0 };
    acc.total += q.venta; acc.n += 1;
    sums.set(m, acc);
  }
  if (sums.size === 0) throw new Error("empty MEP series — check the endpoint payload shape");
  const table: Record<string, number> = {};
  for (const [m, { total, n }] of [...sums].sort()) table[m] = Math.round((total / n) * 100) / 100;
  const out = path.resolve(process.cwd(), "..", "data", "mep.json");
  fs.writeFileSync(out, JSON.stringify(table, null, 1));
  console.log("wrote", out, Object.keys(table).length, "months, latest:", Object.keys(table).sort().at(-1));
}
main().catch(e => { console.error(e); process.exit(1); });
