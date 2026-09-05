import type Database from "better-sqlite3";

export type MatchMethod = "code" | "rule" | "auto";
export type MatchReport = { matched: number; created: number };

/** A rule is a substring of the description; the printer's "?" (ñ, °) stands for any one character. */
export function ruleRegex(match: string): RegExp {
  const escaped = match.replace(/[.*+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}

/** "=HUEVO BLANCOCJA 12 UNI" → "Huevo Blancocja 12 Uni": a readable placeholder until reviewed. */
export function titleCase(desc: string): string {
  return desc.replace(/^=/, "").trim().toLowerCase().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const descOf = (printed: string) => printed.replace(/^=/, "").replace(/\s+/g, " ").trim().toUpperCase();

type Item = { id: number; desc_printed: string; sku: string | null; ean: string | null; unit: "un" | "kg"; chain: string };
type Rule = { match: string; product_id: number };

/**
 * Give every unmatched item of a receipt its product: by article code, else by the first
 * description rule, else by creating a product to review. Codes are learned on the way, so a
 * description matched once by rule is matched by code ever after — and a rule edit later cannot
 * silently move it. One transaction per receipt.
 */
export function matchReceipt(db: Database.Database, receiptId: number): MatchReport {
  const items = db.prepare(`
    SELECT i.id, i.desc_printed, i.sku, i.ean, i.unit, r.chain
    FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
    WHERE i.receipt_id = ? AND i.id NOT IN (SELECT item_id FROM product_matches)
    ORDER BY i.position`).all(receiptId) as Item[];
  const byCode = db.prepare("SELECT product_id FROM product_codes WHERE chain = ? AND sku = ?");
  const rulesOf = db.prepare("SELECT match, product_id FROM product_rules WHERE chain = ? ORDER BY position");
  const byName = db.prepare("SELECT id FROM products WHERE name = ?");
  const insertProduct = db.prepare(
    "INSERT INTO products (name, category, unit, needs_review, created_at) VALUES (?, 'other', ?, 1, ?)");
  const learn = db.prepare("INSERT OR IGNORE INTO product_codes (chain, sku, ean, product_id) VALUES (?, ?, ?, ?)");
  const insertMatch = db.prepare("INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, ?)");
  const rulesCache = new Map<string, Rule[]>();

  const run = db.transaction((): MatchReport => {
    let matched = 0, created = 0;
    for (const it of items) {
      let productId: number | null = null;
      let method: MatchMethod = "auto";
      if (it.sku) {
        const hit = byCode.get(it.chain, it.sku) as { product_id: number } | undefined;
        if (hit) { productId = hit.product_id; method = "code"; }
      }
      if (productId === null) {
        const desc = descOf(it.desc_printed);
        const rules = rulesCache.get(it.chain) ?? (rulesOf.all(it.chain) as Rule[]);
        rulesCache.set(it.chain, rules);
        const rule = rules.find(r => ruleRegex(r.match).test(desc));
        if (rule) { productId = rule.product_id; method = "rule"; }
      }
      if (productId === null) {
        const name = titleCase(it.desc_printed);
        const existing = byName.get(name) as { id: number } | undefined;
        if (existing) productId = existing.id;
        else {
          productId = Number(insertProduct.run(name, it.unit, new Date().toISOString()).lastInsertRowid);
          created++;
        }
        method = "auto";
      }
      if (it.sku && method !== "code") learn.run(it.chain, it.sku, it.ean, productId);
      insertMatch.run(it.id, productId, method);
      matched++;
    }
    return { matched, created };
  });
  return run();
}

/** After a code is moved or a rule edited: rebuild every match from scratch. Auto products stay. */
export function rematchAll(db: Database.Database): MatchReport {
  const receipts = db.prepare("SELECT id FROM receipts ORDER BY date, time, id").all() as { id: number }[];
  const run = db.transaction((): MatchReport => {
    db.prepare("DELETE FROM product_matches").run();
    const total = { matched: 0, created: 0 };
    for (const r of receipts) {
      const report = matchReceipt(db, r.id);
      total.matched += report.matched;
      total.created += report.created;
    }
    return total;
  });
  return run();
}
