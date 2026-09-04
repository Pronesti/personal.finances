import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { ingestReceipt, type ReceiptDeps } from "@/lib/receipts/ingest";
import { receiptList, receiptDetail } from "@/lib/receipts/queries";
import { parseRowsText } from "@/lib/receipts/rows";
import type { Box } from "@/lib/receipts/ocr";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

function boxesFrom(text: string): Box[] {
  const out: Box[] = [];
  let page = 0, y = 0;
  for (const r of parseRowsText(text)) {
    if (r.page !== page) { page = r.page; y = 0; }
    y += 0.01;
    if (r.label) out.push({ page, x: 0.06, y, w: 0.4, h: 0.008, text: r.label });
    if (r.amount !== null) out.push({ page, x: 0.7, y, w: 0.2, h: 0.008, text: r.amount });
  }
  return out;
}
const deps = (text: string): ReceiptDeps => ({
  renderPages: () => [{ page: 1, png: Buffer.alloc(0), width: 1, height: 1 }],
  ocr: async () => boxesFrom(text),
});
// A second receipt: earlier date, different ticket number, same layout.
const EARLIER = SMALL_RECEIPT.replace("04/09/2026 09:42:15 NRO.T.:2090-06514979", "28/08/2026 10:50:12 NRO.T.:2090-06497129");

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-q-"));
  process.env.TARJETAS_RECEIPT_DIR = sandbox;
});
afterEach(() => {
  delete process.env.TARJETAS_RECEIPT_DIR;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("receiptList", () => {
  it("lists receipts newest first with counts and totals", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, Buffer.from("%PDF-a"), deps(EARLIER));
    await ingestReceipt(db, Buffer.from("%PDF-b"), deps(SMALL_RECEIPT));
    expect(receiptList(db)).toEqual([
      expect.objectContaining({ id: 2, date: "2026-09-04", time: "09:42:15", branch_name: "SUC 90 COTO CICSA", items: 6,
        subtotal_cents: 3559626, discounts_cents: -847529, total_cents: 2712097, transcript_source: "ocr" }),
      expect.objectContaining({ id: 1, date: "2026-08-28", items: 6 }),
    ]);
  });
  it("is empty on a fresh database", () => {
    expect(receiptList(openDb(":memory:"))).toEqual([]);
  });
});

describe("receiptDetail", () => {
  it("returns the receipt, its items with their discounts, the report and the transcript", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, Buffer.from("%PDF-a"), deps(SMALL_RECEIPT));
    const d = receiptDetail(db, 1)!;
    expect(d.receipt).toMatchObject({ id: 1, fiscal_number: "2090-06514979", payment_ref: "177204174592" });
    expect(d.items).toHaveLength(6);
    expect(d.items[1]).toMatchObject({ position: 2, desc_printed: "PESCADO FILET A LA ROMANACOTO X KG", qty_milli: 212, unit: "kg" });
    expect(d.items[1].discounts.map(x => x.amount_cents)).toEqual([-135589, -1]);
    expect(d.items[3].discounts).toEqual([]);
    expect(d.report.ok).toBe(true);
    expect(d.transcript).toContain("## page 2");
    expect(d.header).toMatchObject({ cuit: "30-54808315-6" });
  });
  it("returns null for an unknown id", () => {
    expect(receiptDetail(openDb(":memory:"), 99)).toBeNull();
  });
});
