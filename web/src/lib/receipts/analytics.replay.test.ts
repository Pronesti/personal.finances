// The prototype's master.json is the oracle: replaying the five recorded transcripts through
// storage, the seed, the matcher and the analytics must reproduce its numbers. Offline.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { seedProducts } from "@/lib/receipts/seed";
import { parseRowsText, serializeRows } from "@/lib/receipts/rows";
import { parseRows } from "@/lib/receipts/parse";
import { verify } from "@/lib/receipts/verify";
import { storeReceipt, sha256 } from "@/lib/receipts/ingest";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics, type Analytics } from "@/lib/receipts/analytics";
import type { ProductCategory } from "@/lib/receipts/categories";

type Master = {
  weeks: { week: number; date: string; n_items: number; gross: number; discounts: number; total: number; disc_mp: number; disc_coto: number; disc_mixta: number }[];
  index_series: { week: number; idx_lista: number; idx_efectivo: number; n_products: number }[];
  categories: { category: string; total_net: number; total_discount: number }[];
  products: { canonical: string; times_bought: number; price_change_gross_pct: number | null }[];
};
const CATEGORY_KEY: Record<string, ProductCategory> = {
  "Frutas y Verduras": "produce", "Carnes, Pollo y Pescado": "meat_fish", "Lácteos y Postres": "dairy",
  "Fiambres y Embutidos": "deli", "Almacén": "pantry", "Panadería": "bakery", "Comidas Elaboradas": "prepared",
  "Bebidas": "beverages", "Limpieza y Hogar": "cleaning", "Perfumería": "personal_care", "Mascotas": "pets", "Otros": "other",
};

const FIXTURES = path.join(__dirname, "__fixtures__");
const ROWS = path.join(FIXTURES, "rows");
const SEED = path.resolve(__dirname, "../../../../data/products-seed.json");
const files = fs.existsSync(ROWS) ? fs.readdirSync(ROWS).filter(f => f.endsWith(".rows.txt")).sort() : [];
const cents = (n: number) => Math.round(n * 100);

describe.skipIf(files.length === 0 || !fs.existsSync(SEED))("analytics replay against master.json", () => {
  const master = JSON.parse(fs.readFileSync(path.join(FIXTURES, "master.json"), "utf8")) as Master;
  let a: Analytics;
  let sandbox = "";
  let methods: { method: string; n: number }[] = [];
  let autoProducts: string[] = [];

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "replay-"));
    process.env.TARJETAS_RECEIPT_DIR = sandbox;
    const db = openDb(":memory:");
    seedProducts(db, SEED);
    for (const f of files) {
      const rows = parseRowsText(fs.readFileSync(path.join(ROWS, f), "utf8"));
      const parsed = parseRows(rows);
      const report = verify(parsed);
      if (!report.ok) throw new Error(`${f} no longer reconciles: ${JSON.stringify(report.checks)}`);
      const bytes = Buffer.from(`%PDF-replay-${f}`);
      storeReceipt(db, { parsed, report, sha: sha256(bytes), bytes, scale: 3, transcripts: { ocr: serializeRows(rows) } });
    }
    methods = db.prepare("SELECT method, COUNT(*) n FROM product_matches GROUP BY method").all() as typeof methods;
    autoProducts = (db.prepare("SELECT name FROM products WHERE needs_review = 1").all() as { name: string }[]).map(p => p.name);
    const { receipts, items } = loadFacts(db);
    a = buildAnalytics(receipts, items);
  });
  afterAll(() => {
    delete process.env.TARJETAS_RECEIPT_DIR;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("matches every item from the seed, creating nothing", () => {
    expect(autoProducts, "descriptions the seed did not cover — add a rule for each").toEqual([]);
    expect(methods.find(m => m.method === "auto")).toBeUndefined();
    expect(methods.reduce((s, m) => s + m.n, 0)).toBe(master.weeks.reduce((s, w) => s + w.n_items, 0));
  });

  it("reproduces every period: items, gross, discounts, total and the promo split", () => {
    expect(a.periods.map(p => [p.date, p.nItems, p.grossCents, p.discountsCents, p.totalCents, p.mpCents, p.cotoCents, p.mixedCents]))
      .toEqual(master.weeks.map(w => [w.date, w.n_items, cents(w.gross), cents(w.discounts), cents(w.total), cents(w.disc_mp), cents(w.disc_coto), cents(w.disc_mixta)]));
  });

  it("reproduces the chained index, list and effective, to the prototype's two decimals", () => {
    expect(a.index).toHaveLength(master.index_series.length);
    a.index.forEach((p, i) => {
      const m = master.index_series[i];
      expect(p.nProducts, `period ${p.index}`).toBe(m.n_products);
      expect(p.list, `period ${p.index} list`).toBeCloseTo(m.idx_lista, 1);
      expect(p.effective, `period ${p.index} effective`).toBeCloseTo(m.idx_efectivo, 1);
    });
  });

  it("reproduces the category totals", () => {
    const got = new Map(a.categories.map(c => [c.category, c]));
    for (const m of master.categories) {
      const c = got.get(CATEGORY_KEY[m.category])!;
      expect(c, m.category).toBeDefined();
      expect(c.totalNetCents, m.category).toBe(cents(m.total_net));
      expect(c.totalDiscountCents, m.category).toBe(cents(m.total_discount));
    }
  });

  it("reproduces the product count and the essentials", () => {
    expect(a.products).toHaveLength(master.products.length);
    const n = master.weeks.length;
    expect(a.frequency.essentials.map(p => p.name).sort())
      .toEqual(master.products.filter(p => p.times_bought === n).map(p => p.canonical).sort());
  });
});
