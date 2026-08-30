import fs from "node:fs";
import type Database from "better-sqlite3";
import type { Category, CategoryData, Rule } from "@/lib/categorize";
import type { Proposal } from "@/lib/llm";

/**
 * The database side of the merchant rules, the pending LLM proposals and the rejected merchants.
 * These lived in data/merchant-categories.json, which git tracks — so every accept and every
 * per-charge correction dirtied the working tree and had to be committed by hand. The pure
 * transformations still live in lib/categorize.ts; this module only loads and stores.
 */

type RuleRow = { match: string; category: string; subcategory: string | null };

// `subcategory` is optional on Rule, not nullable, and the pure transformations build rules with
// the key absent. Re-inserting a `subcategory: null` here would make a loaded rule unequal to the
// one that was saved, which is exactly what the round-trip tests are for.
function toRule(r: RuleRow): Rule {
  return r.subcategory == null
    ? { match: r.match, category: r.category as Category }
    : { match: r.match, category: r.category as Category, subcategory: r.subcategory };
}

// Ordered by the explicit position column, never by rowid: first match wins, so the order of
// these rows is the difference between MOVISTAR ARENA being a concert and being a phone bill.
export function loadRules(db: Database.Database): Rule[] {
  return (db.prepare(
    "SELECT match, category, subcategory FROM category_rules ORDER BY position"
  ).all() as RuleRow[]).map(toRule);
}

export function loadCategoryData(db: Database.Database): CategoryData {
  return {
    rules: loadRules(db),
    proposals: db.prepare(
      "SELECT merchant, sent, category, subcategory, confidence FROM category_proposals ORDER BY position"
    ).all() as Proposal[],
    rejected: (db.prepare(
      "SELECT merchant FROM rejected_merchants ORDER BY position"
    ).all() as { merchant: string }[]).map(r => r.merchant),
  };
}

// Rewrites all three tables rather than issuing a targeted UPDATE, which is what lets every
// caller keep using the pure transformations in categorize.ts unchanged: they take a CategoryData
// and return a new one, and position is then just the array index. At a few hundred rules the
// rewrite is far cheaper than a second, drifting implementation of "where does this rule go".
export function saveCategoryData(db: Database.Database, data: CategoryData): void {
  db.transaction(() => {
    db.exec("DELETE FROM category_rules; DELETE FROM category_proposals; DELETE FROM rejected_merchants");
    const rule = db.prepare(
      "INSERT INTO category_rules (position, match, category, subcategory) VALUES (?, ?, ?, ?)"
    );
    data.rules.forEach((r, i) => rule.run(i, r.match, r.category, r.subcategory ?? null));
    const proposal = db.prepare(
      `INSERT INTO category_proposals (position, merchant, sent, category, subcategory, confidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    data.proposals.forEach((p, i) => proposal.run(i, p.merchant, p.sent, p.category, p.subcategory, p.confidence));
    const rejected = db.prepare("INSERT INTO rejected_merchants (position, merchant) VALUES (?, ?)");
    data.rejected.forEach((m, i) => rejected.run(i, m));
  })();
}

// Seeds a fresh database from the JSON file the rules used to live in, in file order. Guarded on
// the tables being empty rather than on a migration marker: the file is the seed and the fallback
// until it is deleted, and this check goes with it.
export function seedCategoryData(db: Database.Database, file: string): void {
  const empty = (t: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n === 0;
  if (!empty("category_rules") || !empty("category_proposals") || !empty("rejected_merchants")) return;
  if (!fs.existsSync(file)) return;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CategoryData>;
  saveCategoryData(db, {
    rules: raw.rules ?? [], proposals: raw.proposals ?? [], rejected: raw.rejected ?? [],
  });
}
