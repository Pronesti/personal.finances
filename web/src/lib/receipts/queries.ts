import type Database from "better-sqlite3";
import type { VerificationReport } from "./verify";
import type { ParsedOffer } from "./parse";

export type ReceiptSummary = {
  id: number; date: string; time: string | null; branch_name: string | null;
  items: number; subtotal_cents: number; discounts_cents: number; total_cents: number;
  transcript_source: "ocr" | "corrected";
};

export type ReceiptRow = {
  id: number; chain: string; branch_code: string | null; branch_name: string | null;
  date: string; time: string | null; fiscal_number: string; file_sha256: string; file_path: string;
  register: string | null; terminal: string | null; trx: string | null; cae: string | null; cae_due: string | null;
  payment_method: string | null; payment_ref: string | null;
  subtotal_cents: number; discounts_cents: number; total_cents: number;
  transcript_source: "ocr" | "corrected"; ocr_scale: number; created_at: string;
};
export type DiscountRow = { id: number; position: number; label: string; tag: "M" | "A"; amount_cents: number };
export type ItemRow = {
  id: number; position: number; desc_printed: string; no_promo: number; sku: string | null; ean: string | null;
  qty_milli: number; unit: "un" | "kg"; unit_price_cents: number | null; line_total_cents: number;
  discounts: DiscountRow[];
};
export type ReceiptHeaderExtras = {
  cuit: string | null; paymentCents: number | null; savingsCents: number | null; offers: ParsedOffer[]; notes: string[];
};
export type ReceiptDetail = {
  receipt: ReceiptRow;
  header: ReceiptHeaderExtras;
  items: ItemRow[];
  report: VerificationReport;
  transcript: string;
};

export function receiptList(db: Database.Database): ReceiptSummary[] {
  return db.prepare(`
    SELECT r.id, r.date, r.time, r.branch_name,
           (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id = r.id) AS items,
           r.subtotal_cents, r.discounts_cents, r.total_cents, r.transcript_source
    FROM receipts r
    ORDER BY r.date DESC, r.time DESC, r.id DESC
  `).all() as ReceiptSummary[];
}

export function receiptDetail(db: Database.Database, id: number): ReceiptDetail | null {
  const row = db.prepare(`
    SELECT id, chain, branch_code, branch_name, date, time, fiscal_number, file_sha256, file_path,
           register, terminal, trx, cae, cae_due, payment_method, payment_ref,
           subtotal_cents, discounts_cents, total_cents, transcript_source, ocr_scale, created_at,
           header_json, verification_json
    FROM receipts WHERE id = ?
  `).get(id) as (ReceiptRow & { header_json: string; verification_json: string }) | undefined;
  if (!row) return null;
  const { header_json, verification_json, ...receipt } = row;
  const items = db.prepare(`
    SELECT id, position, desc_printed, no_promo, sku, ean, qty_milli, unit, unit_price_cents, line_total_cents
    FROM receipt_items WHERE receipt_id = ? ORDER BY position
  `).all(id) as Omit<ItemRow, "discounts">[];
  const discounts = db.prepare(`
    SELECT d.id, d.item_id, d.position, d.label, d.tag, d.amount_cents
    FROM receipt_discounts d JOIN receipt_items i ON i.id = d.item_id
    WHERE i.receipt_id = ? ORDER BY d.item_id, d.position
  `).all(id) as (DiscountRow & { item_id: number })[];
  const byItem = new Map<number, DiscountRow[]>();
  for (const { item_id, ...d } of discounts) byItem.set(item_id, [...(byItem.get(item_id) ?? []), d]);
  // The corrected transcript, when there is one, is the one that reconciled — show that.
  const transcript = db.prepare(`
    SELECT text FROM receipt_transcripts WHERE receipt_id = ? ORDER BY CASE kind WHEN 'corrected' THEN 0 ELSE 1 END LIMIT 1
  `).get(id) as { text: string } | undefined;
  return {
    receipt,
    header: (() => {
      const parsedHeader = JSON.parse(header_json) as ReceiptHeaderExtras;
      return { ...parsedHeader, notes: parsedHeader.notes ?? [] };
    })(),
    items: items.map(it => ({ ...it, discounts: byItem.get(it.id) ?? [] })),
    report: JSON.parse(verification_json) as VerificationReport,
    transcript: transcript?.text ?? "",
  };
}
