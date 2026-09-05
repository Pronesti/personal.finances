import type Database from "better-sqlite3";
import { isProductCategory, type ProductCategory } from "./categories";

export type ReviewProduct = {
  id: number; name: string; category: ProductCategory; unit: "un" | "kg";
  descriptions: string[]; codes: string[]; timesBought: number; totalSpentCents: number;
};
export type ProductOption = { id: number; name: string };

/** Products the matcher invented, with the evidence a reviewer needs to name and file them. */
export function reviewQueue(db: Database.Database): ReviewProduct[] {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit,
           (SELECT COUNT(*) FROM product_matches m WHERE m.product_id = p.id) AS timesBought,
           (SELECT COALESCE(SUM(i.line_total_cents + COALESCE((SELECT SUM(d.amount_cents) FROM receipt_discounts d WHERE d.item_id = i.id), 0)), 0)
              FROM product_matches m JOIN receipt_items i ON i.id = m.item_id WHERE m.product_id = p.id) AS totalSpentCents
    FROM products p WHERE p.needs_review = 1 ORDER BY totalSpentCents DESC, p.name`).all() as Omit<ReviewProduct, "descriptions" | "codes">[];
  const descs = db.prepare(`
    SELECT DISTINCT i.desc_printed FROM product_matches m JOIN receipt_items i ON i.id = m.item_id
    WHERE m.product_id = ? ORDER BY i.desc_printed`);
  const codes = db.prepare("SELECT sku FROM product_codes WHERE product_id = ? ORDER BY sku");
  return rows.map(r => ({
    ...r,
    descriptions: (descs.all(r.id) as { desc_printed: string }[]).map(d => d.desc_printed),
    codes: (codes.all(r.id) as { sku: string }[]).map(c => c.sku),
  }));
}

export function allProducts(db: Database.Database): ProductOption[] {
  return db.prepare("SELECT id, name FROM products ORDER BY name").all() as ProductOption[];
}

export function updateProduct(
  db: Database.Database, id: number,
  patch: { name: string; category: ProductCategory; unit: "un" | "kg"; needsReview: boolean },
): void {
  const name = patch.name.trim();
  if (!name) throw new Error("product name is required");
  if (!isProductCategory(patch.category)) throw new Error(`unknown category "${patch.category}"`);
  if (patch.unit !== "un" && patch.unit !== "kg") throw new Error(`unknown unit "${patch.unit}"`);
  // The UNIQUE constraint on name is the guard against a duplicate; SQLite throws, the action reports.
  const r = db.prepare("UPDATE products SET name = ?, category = ?, unit = ?, needs_review = ? WHERE id = ?")
    .run(name, patch.category, patch.unit, patch.needsReview ? 1 : 0, id);
  if (r.changes === 0) throw new Error(`no product ${id}`);
}

/** Everything that pointed at `sourceId` now points at `targetId`; the source row goes. */
export function mergeProducts(db: Database.Database, sourceId: number, targetId: number): void {
  if (sourceId === targetId) throw new Error("cannot merge a product into itself");
  const run = db.transaction(() => {
    const target = db.prepare("SELECT id FROM products WHERE id = ?").get(targetId);
    if (!target) throw new Error(`no product ${targetId}`);
    db.prepare("UPDATE product_codes SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE product_rules SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE product_matches SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    const r = db.prepare("DELETE FROM products WHERE id = ?").run(sourceId);
    if (r.changes === 0) throw new Error(`no product ${sourceId}`);
  });
  run();
}

/** One article code was filed under the wrong product: move it, and every item that carries it. */
export function moveCode(db: Database.Database, chain: string, sku: string, targetId: number): void {
  const run = db.transaction(() => {
    const r = db.prepare("UPDATE product_codes SET product_id = ? WHERE chain = ? AND sku = ?").run(targetId, chain, sku);
    if (r.changes === 0) throw new Error(`no code ${chain}/${sku}`);
    db.prepare(`
      UPDATE product_matches SET product_id = ?, method = 'code'
      WHERE item_id IN (SELECT i.id FROM receipt_items i JOIN receipts rc ON rc.id = i.receipt_id WHERE rc.chain = ? AND i.sku = ?)`)
      .run(targetId, chain, sku);
  });
  run();
}
