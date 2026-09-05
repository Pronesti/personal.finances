import fs from "node:fs";
import type Database from "better-sqlite3";
import { isProductCategory, type ProductCategory } from "./categories";

export type ProductSeed = {
  products: { name: string; category: ProductCategory; unit: "un" | "kg" }[];
  codes: { chain: string; sku: string; ean: string | null; product: string }[];
  rules: { match: string; product: string }[];
};

/**
 * One-time import of data/products-seed.json, guarded on `products` being empty so a second run
 * is a no-op and a database the user has edited is never overwritten. Same contract as the
 * merchant seeds this replaces in spirit. Validates before writing: a typo in the JSON must fail
 * loudly here, not become a product with a category no page knows how to colour.
 */
export function seedProducts(db: Database.Database, file: string): void {
  const count = (db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n;
  if (count > 0 || !fs.existsSync(file)) return;
  const seed = JSON.parse(fs.readFileSync(file, "utf8")) as ProductSeed;
  const load = db.transaction(() => {
    const ids = new Map<string, number>();
    const insertProduct = db.prepare(
      "INSERT INTO products (name, category, unit, needs_review, created_at) VALUES (?, ?, ?, 0, ?)");
    const now = new Date().toISOString();
    for (const p of seed.products) {
      if (!isProductCategory(p.category)) throw new Error(`seed: unknown category "${p.category}" for "${p.name}"`);
      if (p.unit !== "un" && p.unit !== "kg") throw new Error(`seed: unknown unit "${p.unit}" for "${p.name}"`);
      ids.set(p.name, Number(insertProduct.run(p.name, p.category, p.unit, now).lastInsertRowid));
    }
    const idOf = (name: string): number => {
      const id = ids.get(name);
      if (id === undefined) throw new Error(`seed: unknown product "${name}"`);
      return id;
    };
    const insertCode = db.prepare("INSERT INTO product_codes (chain, sku, ean, product_id) VALUES (?, ?, ?, ?)");
    for (const c of seed.codes) insertCode.run(c.chain, c.sku, c.ean, idOf(c.product));
    const insertRule = db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (?, 'coto', ?, ?)");
    seed.rules.forEach((r, i) => insertRule.run(i, r.match, idOf(r.product)));
  });
  load();
}
