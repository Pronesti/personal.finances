import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchReceipt } from "@/lib/receipts/match";
import { reviewQueue, allProducts, updateProduct, mergeProducts, moveCode } from "@/lib/receipts/products";

type Db = ReturnType<typeof openDb>;
function receipt(db: Db, fiscal: string, lines: { desc: string; sku: string; total: number; discount?: number }[]): number {
  const r = db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, `sha-${fiscal}`);
  const id = Number(r.lastInsertRowid);
  lines.forEach((l, i) => {
    const it = db.prepare(`INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, qty_milli, unit, line_total_cents)
      VALUES (?, ?, ?, ?, 1000, 'un', ?)`).run(id, i + 1, l.desc, l.sku, l.total);
    if (l.discount) db.prepare(`INSERT INTO receipt_discounts (item_id, position, label, tag, amount_cents) VALUES (?, 1, 'MP', 'M', ?)`)
      .run(it.lastInsertRowid, l.discount);
  });
  matchReceipt(db, id);
  return id;
}
const product = (db: Db, name: string, category = "pantry", unit = "un") =>
  Number(db.prepare("INSERT INTO products (name, category, unit, created_at) VALUES (?, ?, ?, 'now')").run(name, category, unit).lastInsertRowid);

describe("reviewQueue", () => {
  it("lists auto-created products with what was seen and what was spent", () => {
    const db = openDb(":memory:");
    product(db, "Reviewed already");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 2195000, discount: -548750 }, { desc: "=PISI", sku: "0000012346", total: 2000000 }]);
    receipt(db, "2", [{ desc: "PISI", sku: "0000012345", total: 2195000 }]);
    expect(reviewQueue(db)).toEqual([{
      id: 2, name: "Pisi", category: "other", unit: "un",
      descriptions: ["=PISI", "PISI"], codes: ["0000012345", "0000012346"], timesBought: 3, totalSpentCents: 5841250,
    }]);
    expect(allProducts(db)).toEqual([{ id: 2, name: "Pisi" }, { id: 1, name: "Reviewed already" }]);
  });
});

describe("updateProduct", () => {
  it("renames, recategorises and clears the review flag", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 100 }]);
    updateProduct(db, 1, { name: "Sopa Pisi (sobre)", category: "pantry", unit: "un", needsReview: false });
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products").get())
      .toEqual({ name: "Sopa Pisi (sobre)", category: "pantry", unit: "un", needs_review: 0 });
    expect(reviewQueue(db)).toEqual([]);
  });
  it("rejects an empty name, an unknown category, or a name another product owns", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "PISI", sku: "0000012345", total: 100 }]);
    product(db, "Taken");
    expect(() => updateProduct(db, 1, { name: "  ", category: "pantry", unit: "un", needsReview: false })).toThrow(/name/);
    expect(() => updateProduct(db, 1, { name: "X", category: "snacks" as never, unit: "un", needsReview: false })).toThrow(/category/);
    expect(() => updateProduct(db, 1, { name: "Taken", category: "pantry", unit: "un", needsReview: false })).toThrow();
  });
});

describe("mergeProducts", () => {
  it("moves codes, rules and matches to the target and deletes the source", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "FELPITA", sku: "0000000001", total: 100 }, { desc: "ROLLO D/COCINA MAXIR", sku: "0000000002", total: 100 }]);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'FELPITA', 1)").run();
    mergeProducts(db, 1, 2);
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT DISTINCT product_id FROM product_codes").all()).toEqual([{ product_id: 2 }]);
    expect(db.prepare("SELECT product_id FROM product_rules").all()).toEqual([{ product_id: 2 }]);
    expect(db.prepare("SELECT DISTINCT product_id FROM product_matches").all()).toEqual([{ product_id: 2 }]);
  });
  it("refuses to merge a product into itself or into nothing", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "FELPITA", sku: "0000000001", total: 100 }]);
    expect(() => mergeProducts(db, 1, 1)).toThrow();
    expect(() => mergeProducts(db, 1, 99)).toThrow();
    expect(db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({ n: 1 });
  });
});

describe("moveCode", () => {
  it("re-points one article code and the items that carry it", () => {
    const db = openDb(":memory:");
    receipt(db, "1", [{ desc: "OREO", sku: "0000000001", total: 100 }, { desc: "OREO", sku: "0000000002", total: 100 }]);
    const cookies = product(db, "Galletitas Oreo (118 g)");
    moveCode(db, "coto", "0000000002", cookies);
    expect(db.prepare("SELECT sku, product_id FROM product_codes ORDER BY sku").all())
      .toEqual([{ sku: "0000000001", product_id: 1 }, { sku: "0000000002", product_id: cookies }]);
    expect(db.prepare(`SELECT i.position, m.product_id, m.method FROM product_matches m JOIN receipt_items i ON i.id = m.item_id ORDER BY i.position`).all())
      .toEqual([{ position: 1, product_id: 1, method: "auto" }, { position: 2, product_id: cookies, method: "code" }]);
  });
});
