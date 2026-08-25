import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/lib/db";
import { loadRules } from "../src/lib/categorize";
import { loadAliases } from "../src/lib/aliases";
import { ingestFile } from "../src/lib/ingest";
import type { StatementJson } from "../src/lib/integrity";

async function main() {
  const jsonDir = path.resolve(process.cwd(), "..", "json");
  const db = openDb();
  const rules = loadRules();
  const aliases = loadAliases();
  const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json")).sort();
  let alertTotal = 0;
  for (const f of files) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(jsonDir, f), "utf8")) as StatementJson;
      ingestFile(db, json, rules, aliases);
    } catch (e) {
      throw new Error(`ingest failed on ${f}: ${(e as Error).message}`);
    }
  }
  alertTotal = (db.prepare("SELECT COUNT(*) n FROM alerts").get() as { n: number }).n;
  console.log(`done: ${files.length} statements, ${alertTotal} integrity alerts`);
}
main().catch(e => { console.error(e); process.exit(1); });
