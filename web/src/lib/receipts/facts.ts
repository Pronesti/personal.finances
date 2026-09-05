import type Database from "better-sqlite3";
import type { ProductCategory } from "./categories";

export type ReceiptFact = {
  id: number; date: string; time: string | null;
  subtotalCents: number; discountsCents: number; totalCents: number;
};
export type ItemFact = {
  receiptId: number; productId: number; productName: string; category: ProductCategory; unit: "un" | "kg";
  qtyMilli: number; grossCents: number; discountCents: number; hasM: boolean; hasA: boolean;
};

/** Everything the analytics need, as flat rows. Items without a product match are not rows. */
export function loadFacts(db: Database.Database): { receipts: ReceiptFact[]; items: ItemFact[] } {
  const receipts = db.prepare(`
    SELECT id, date, time, subtotal_cents AS subtotalCents, discounts_cents AS discountsCents, total_cents AS totalCents
    FROM receipts ORDER BY date, time, id`).all() as ReceiptFact[];
  const rows = db.prepare(`
    SELECT i.receipt_id AS receiptId, p.id AS productId, p.name AS productName, p.category, p.unit,
           i.qty_milli AS qtyMilli, i.line_total_cents AS grossCents,
           COALESCE((SELECT SUM(d.amount_cents) FROM receipt_discounts d WHERE d.item_id = i.id), 0) AS discountCents,
           EXISTS (SELECT 1 FROM receipt_discounts d WHERE d.item_id = i.id AND d.tag = 'M') AS hasM,
           EXISTS (SELECT 1 FROM receipt_discounts d WHERE d.item_id = i.id AND d.tag = 'A') AS hasA
    FROM receipt_items i
    JOIN product_matches m ON m.item_id = i.id
    JOIN products p ON p.id = m.product_id
    JOIN receipts r ON r.id = i.receipt_id
    ORDER BY r.date, r.time, r.id, i.position`).all() as (Omit<ItemFact, "hasM" | "hasA"> & { hasM: number; hasA: number })[];
  return { receipts, items: rows.map(r => ({ ...r, hasM: r.hasM === 1, hasA: r.hasA === 1 })) };
}
