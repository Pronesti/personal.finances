import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/lib/db";
import { loadRules } from "../src/lib/rules";
import { loadAliases } from "../src/lib/aliases";
import { ingestFile } from "../src/lib/ingest";
import type { StatementJson } from "../src/lib/integrity";

async function main() {
  const jsonDir = path.resolve(process.cwd(), "..", "json");
  const db = openDb();
  const rules = loadRules(db);
  const aliases = loadAliases(db);
  const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json")).sort();
  let alertTotal = 0;
  for (const f of files) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(jsonDir, f), "utf8")) as StatementJson;
      alertTotal += ingestFile(db, json, rules, aliases).alerts.length;
    } catch (e) {
      throw new Error(`ingest failed on ${f}: ${(e as Error).message}`);
    }
  }
  // files.length is the number of JSONs read, not the number of statements that survived
  // superseding — only the DB knows that, and it is what every later verification checks.
  const { n } = db.prepare("SELECT COUNT(*) n FROM statements").get() as { n: number };
  console.log(`done: ${n} statements from ${files.length} files, ${alertTotal} integrity alerts`);
}
main().catch(e => { console.error(e); process.exit(1); });
