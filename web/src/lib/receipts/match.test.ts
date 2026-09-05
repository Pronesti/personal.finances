import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchReceipt, rematchAll, ruleRegex, titleCase } from "@/lib/receipts/match";

type Line = { desc: string; sku: string | null; unit?: "un" | "kg" };

function receipt(db: ReturnType<typeof openDb>, fiscal: string, lines: Line[]): number {
  const r = db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, `sha-${fiscal}`);
  const id = Number(r.lastInsertRowid);
  lines.forEach((l, i) => db.prepare(
    `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, ean, qty_milli, unit, line_total_cents)
     VALUES (?, ?, ?, ?, ?, 1000, ?, 100)`).run(id, i + 1, l.desc, l.sku, l.sku ? `0${l.sku}000` : null, l.unit ?? "un"));
  return id;
}
function product(db: ReturnType<typeof openDb>, name: string, category = "produce", unit = "kg"): number {
  return Number(db.prepare("INSERT INTO products (name, category, unit, created_at) VALUES (?, ?, ?, 'now')").run(name, category, unit).lastInsertRowid);
}
const matches = (db: ReturnType<typeof openDb>) =>
  db.prepare(`SELECT i.position, p.name, m.method FROM product_matches m
              JOIN receipt_items i ON i.id = m.item_id JOIN products p ON p.id = m.product_id ORDER BY i.receipt_id, i.position`).all();

describe("ruleRegex / titleCase", () => {
  it("treats the printer's ? as any one character and matches as a substring", () => {
    expect(ruleRegex("PA?UELOS CAMPANITA").test("PAZUELOS CAMPANITACJA 75 UNI")).toBe(true);
    expect(ruleRegex("PA?UELOS CAMPANITA").test("PAÑUELOS CAMPANITA")).toBe(true);
    expect(ruleRegex("FID.PENNE").test("FID.PENNE RIGATE N?4")).toBe(true);
    expect(ruleRegex("FID.PENNE").test("FIDXPENNE")).toBe(false); // the dot is literal
  });
  it("title-cases a printed description without the = marker", () => {
    expect(titleCase("=HUEVO BLANCOCJA 12 UNI")).toBe("Huevo Blancocja 12 Uni");
    expect(titleCase("AGUA  SIN GAS")).toBe("Agua Sin Gas");
  });
});

describe("matchReceipt", () => {
  it("matches by article code first", () => {
    const db = openDb(":memory:");
    const banana = product(db, "Banana Cavendish (por kg)");
    db.prepare("INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000446', ?)").run(banana);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'BANANA', ?)").run(product(db, "Wrong banana"));
    const id = receipt(db, "1", [{ desc: "=BANANA CAVENDISHX KG", sku: "0000000446" }]);
    expect(matchReceipt(db, id)).toEqual({ matched: 1, created: 0 });
    expect(matches(db)).toEqual([{ position: 1, name: "Banana Cavendish (por kg)", method: "code" }]);
  });

  it("falls back to the first rule by position and learns the code", () => {
    const db = openDb(":memory:");
    const specific = product(db, "Huevo blanco (caja 12)");
    const generic = product(db, "Huevo (otros)");
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'HUEVO BLANCOCJA 12', ?)").run(specific);
    db.prepare("INSERT INTO product_rules (position, chain, match, product_id) VALUES (1, 'coto', 'HUEVO', ?)").run(generic);
    const id = receipt(db, "1", [{ desc: "=HUEVO BLANCOCJA 12 UNI", sku: "0000022865" }, { desc: "HUEVO COLOR CJA 6", sku: "0000022866" }]);
    matchReceipt(db, id);
    expect(matches(db)).toEqual([
      { position: 1, name: "Huevo blanco (caja 12)", method: "rule" },
      { position: 2, name: "Huevo (otros)", method: "rule" },
    ]);
    expect(db.prepare("SELECT sku, ean, product_id FROM product_codes ORDER BY sku").all()).toEqual([
      { sku: "0000022865", ean: "00000022865000", product_id: specific },
      { sku: "0000022866", ean: "00000022866000", product_id: generic },
    ]);
  });

  it("creates a product flagged for review when nothing matches, once per description", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [
      { desc: "PISI", sku: "0000012345" }, { desc: "PISI", sku: "0000012346" }, { desc: "0,374 KG MORCILLA", sku: null, unit: "kg" },
    ]);
    expect(matchReceipt(db, id)).toEqual({ matched: 3, created: 2 });
    expect(db.prepare("SELECT name, category, unit, needs_review FROM products ORDER BY id").all()).toEqual([
      { name: "Pisi", category: "other", unit: "un", needs_review: 1 },
      { name: "0,374 Kg Morcilla", category: "other", unit: "kg", needs_review: 1 },
    ]);
    expect((matches(db) as Array<{ method: string }>).map(m => m.method)).toEqual(["auto", "auto", "auto"]);
    // both PISI codes now point at the one product
    expect(db.prepare("SELECT COUNT(DISTINCT product_id) n FROM product_codes").get()).toEqual({ n: 1 });
  });

  it("is idempotent and only touches unmatched items", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [{ desc: "PISI", sku: "0000012345" }]);
    matchReceipt(db, id);
    expect(matchReceipt(db, id)).toEqual({ matched: 0, created: 0 });
  });
});

describe("rematchAll", () => {
  it("drops every match and rebuilds from codes and rules, so a moved code takes effect", () => {
    const db = openDb(":memory:");
    const id = receipt(db, "1", [{ desc: "PISI", sku: "0000012345" }]);
    matchReceipt(db, id);
    const real = product(db, "Sopa Pisi", "pantry", "un");
    db.prepare("UPDATE product_codes SET product_id = ? WHERE sku = '0000012345'").run(real);
    expect(rematchAll(db)).toEqual({ matched: 1, created: 0 });
    expect(matches(db)).toEqual([{ position: 1, name: "Sopa Pisi", method: "code" }]);
  });
});
