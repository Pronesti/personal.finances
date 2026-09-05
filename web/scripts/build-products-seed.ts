// One-off: the prototype's master.json (canonical name, category, unit per printed line) paired
// with P1's recorded transcripts (article code and description as OCR read it, same order) →
// data/products-seed.json. Receipts are paired by their printed date, items by position.
//
//   npm run build-products-seed -- src/lib/receipts/__fixtures__/master.json
import fs from "node:fs";
import path from "node:path";
import { parseRowsText } from "../src/lib/receipts/rows";
import { parseRows } from "../src/lib/receipts/parse";
import type { ProductCategory } from "../src/lib/receipts/categories";
import type { ProductSeed } from "../src/lib/receipts/seed";

type MasterItem = { week: number; date: string; desc_printed: string; canonical: string; category: string; unit: "un" | "kg" };
type Master = { items: MasterItem[] };

const CATEGORY_KEY: Record<string, ProductCategory> = {
  "Frutas y Verduras": "produce", "Carnes, Pollo y Pescado": "meat_fish", "Lácteos y Postres": "dairy",
  "Fiambres y Embutidos": "deli", "Almacén": "pantry", "Panadería": "bakery", "Comidas Elaboradas": "prepared",
  "Bebidas": "beverages", "Limpieza y Hogar": "cleaning", "Perfumería": "personal_care", "Mascotas": "pets", "Otros": "other",
};

const masterPath = process.argv[2];
if (!masterPath) { console.error("usage: build-products-seed.ts <master.json>"); process.exit(2); }
const master = JSON.parse(fs.readFileSync(masterPath, "utf8")) as Master;
const rowsDir = path.resolve(__dirname, "../src/lib/receipts/__fixtures__/rows");
const out = path.resolve(__dirname, "../../data/products-seed.json");

const norm = (s: string) => s.replace(/^=/, "").replace(/\s+/g, " ").trim().toUpperCase();

const products = new Map<string, ProductSeed["products"][number]>();
const codes = new Map<string, ProductSeed["codes"][number]>();
const rules = new Map<string, string>(); // match → product name

for (const it of master.items) {
  const category = CATEGORY_KEY[it.category];
  if (!category) throw new Error(`no key for category "${it.category}"`);
  const existing = products.get(it.canonical);
  if (existing && (existing.category !== category || existing.unit !== it.unit))
    throw new Error(`"${it.canonical}" has two categories or units in master.json`);
  products.set(it.canonical, { name: it.canonical, category, unit: it.unit });
  rules.set(norm(it.desc_printed), it.canonical);
}

// Pair each recorded receipt with the prototype's items of the same date, position by position.
const byDate = new Map<string, MasterItem[]>();
for (const it of master.items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
for (const file of fs.readdirSync(rowsDir).filter(f => f.endsWith(".rows.txt")).sort()) {
  const parsed = parseRows(parseRowsText(fs.readFileSync(path.join(rowsDir, file), "utf8")));
  const expected = byDate.get(parsed.header.date ?? "");
  if (!expected) throw new Error(`${file}: master.json has no receipt dated ${parsed.header.date}`);
  if (expected.length !== parsed.items.length)
    throw new Error(`${file}: ${parsed.items.length} items read, master.json has ${expected.length}`);
  parsed.items.forEach((item, i) => {
    const canonical = expected[i].canonical;
    if (item.sku) {
      const prev = codes.get(item.sku);
      if (prev && prev.product !== canonical)
        throw new Error(`${file}: code ${item.sku} maps to "${prev.product}" and "${canonical}"`);
      codes.set(item.sku, { chain: "coto", sku: item.sku, ean: item.ean, product: canonical });
    }
    rules.set(norm(item.descPrinted), canonical);
  });
}

// Longer descriptions first: a specific line must be tried before a generic one it contains.
const seed: ProductSeed = {
  products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name)),
  codes: [...codes.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
  rules: [...rules.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([match, product]) => ({ match, product })),
};
fs.writeFileSync(out, JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.products.length} products, ${seed.codes.length} codes, ${seed.rules.length} rules → ${path.relative(process.cwd(), out)}`);
