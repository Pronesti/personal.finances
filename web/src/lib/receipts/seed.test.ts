import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { seedProducts, type ProductSeed } from "@/lib/receipts/seed";

const seed: ProductSeed = {
  products: [
    { name: "Banana Cavendish (por kg)", category: "produce", unit: "kg" },
    { name: "Agua Levité Cero pomelo (2,25 L)", category: "beverages", unit: "un" },
  ],
  codes: [{ chain: "coto", sku: "0000000446", ean: "02500446010727", product: "Banana Cavendish (por kg)" }],
  rules: [
    { match: "AGUA SIN GAS V.D.S LEVITE CEROPOMELO BOT 2.25 LT", product: "Agua Levité Cero pomelo (2,25 L)" },
    { match: "BANANA CAVENDISHX KG", product: "Banana Cavendish (por kg)" },
  ],
};

function write(seedData: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
  const file = path.join(dir, "products-seed.json");
  fs.writeFileSync(file, JSON.stringify(seedData));
  return file;
}

describe("seedProducts", () => {
  it("loads products, codes and ordered rules into an empty database", () => {
    const db = openDb(":memory:");
    seedProducts(db, write(seed));
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products ORDER BY id").all()).toEqual([
      { name: "Banana Cavendish (por kg)", category: "produce", unit: "kg", needs_review: 0 },
      { name: "Agua Levité Cero pomelo (2,25 L)", category: "beverages", unit: "un", needs_review: 0 },
    ]);
    expect(db.prepare("SELECT chain, sku, ean FROM product_codes").all()).toEqual([{ chain: "coto", sku: "0000000446", ean: "02500446010727" }]);
    expect(db.prepare("SELECT position, match FROM product_rules ORDER BY position").all()).toEqual([
      { position: 0, match: "AGUA SIN GAS V.D.S LEVITE CEROPOMELO BOT 2.25 LT" },
      { position: 1, match: "BANANA CAVENDISHX KG" },
    ]);
  });

  it("is a no-op when products exist or the file is missing", () => {
    const db = openDb(":memory:");
    seedProducts(db, path.join(os.tmpdir(), "no-such-seed.json"));
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 0 });
    const file = write(seed);
    seedProducts(db, file);
    seedProducts(db, write({ ...seed, products: [{ name: "Other", category: "other", unit: "un" }] }));
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 2 });
  });

  it("rejects a seed that names an unknown category or product", () => {
    const db = openDb(":memory:");
    expect(() => seedProducts(db, write({ ...seed, products: [{ name: "X", category: "snacks", unit: "un" }], codes: [], rules: [] })))
      .toThrow(/category/);
    expect(() => seedProducts(db, write({ ...seed, rules: [{ match: "X", product: "Nope" }] }))).toThrow(/Nope/);
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 0 }); // transaction rolled back
  });
});
