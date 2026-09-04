import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { Failure } from "@/lib/failure";
import {
  ingestReceipt, ingestCorrected, ReceiptRejected, receiptDir, sha256, MAX_RECEIPT_BYTES, type ReceiptDeps,
} from "@/lib/receipts/ingest";
import { parseRowsText } from "@/lib/receipts/rows";
import type { Box } from "@/lib/receipts/ocr";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

// Boxes as Vision would lay them out for a given rows text: label at the left, amount at the
// right, one line per row. Lets the whole orchestration run with no PDF and no OCR.
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

// One OCR result per scale attempt, in order; the render step is a stub.
function deps(perScale: string[]): ReceiptDeps & { scales: number[] } {
  const scales: number[] = [];
  return {
    scales,
    renderPages: (_pdf, scale) => { scales.push(scale); return [{ page: 1, png: Buffer.alloc(0), width: 1, height: 1 }]; },
    ocr: async () => boxesFrom(perScale[Math.min(scales.length, perScale.length) - 1]),
  };
}

const pdf = Buffer.from("%PDF-1.4 a receipt");
const BROKEN = SMALL_RECEIPT.replace("6400,00", "6490,00"); // one misread digit: subtotal off by 90,00

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-"));
  process.env.TARJETAS_RECEIPT_DIR = path.join(sandbox, "receipts");
});
afterEach(() => {
  delete process.env.TARJETAS_RECEIPT_DIR;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("ingestReceipt", () => {
  it("stores a receipt that reconciles at the first scale", async () => {
    const db = openDb(":memory:");
    const d = deps([SMALL_RECEIPT]);
    const stored = await ingestReceipt(db, pdf, d);
    expect(d.scales).toEqual([3]);
    expect(stored).toMatchObject({ id: 1, date: "2026-09-04", totalCents: 2712097, items: 6 });
    expect(stored.report.ok).toBe(true);
    const row = db.prepare("SELECT * FROM receipts WHERE id = 1").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      chain: "coto", branch_code: "090", date: "2026-09-04", time: "09:42:15", fiscal_number: "2090-06514979",
      file_sha256: sha256(pdf), register: "0012", terminal: "3791", trx: "4969", cae: "86361418114640",
      payment_method: "MERCADO PAG", payment_ref: "177204174592",
      subtotal_cents: 3559626, discounts_cents: -847529, total_cents: 2712097,
      transcript_source: "ocr", ocr_scale: 3,
    });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_items").get()).toEqual({ n: 6 });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_discounts").get()).toEqual({ n: 6 });
    expect(db.prepare("SELECT kind FROM receipt_transcripts").all()).toEqual([{ kind: "ocr" }]);
    expect(fs.existsSync(path.join(receiptDir(), `${sha256(pdf)}.pdf`))).toBe(true);
    expect(JSON.parse(row.header_json as string)).toMatchObject({ cuit: "30-54808315-6" });
  });

  it("tries the next scale when the first does not reconcile, and records the one that did", async () => {
    const db = openDb(":memory:");
    const d = deps([BROKEN, SMALL_RECEIPT]);
    const stored = await ingestReceipt(db, pdf, d);
    expect(d.scales).toEqual([3, 2]);
    expect(db.prepare("SELECT ocr_scale FROM receipts").get()).toEqual({ ocr_scale: 2 });
    expect(stored.items).toBe(6);
  });

  it("rejects after every scale fails, keeps the PDF pending, stores nothing", async () => {
    const db = openDb(":memory:");
    const d = deps([BROKEN, BROKEN, BROKEN]);
    const run = ingestReceipt(db, pdf, d);
    await expect(run).rejects.toBeInstanceOf(ReceiptRejected);
    await run.catch((e: ReceiptRejected) => {
      expect(e.payload.sha256).toBe(sha256(pdf));
      expect(e.payload.report.ok).toBe(false);
      expect(e.payload.rowsText).toContain("6490,00");
      expect(e.payload.scale).toBe(3);
    });
    expect(d.scales).toEqual([3, 2, 1.5]);
    expect(db.prepare("SELECT COUNT(*) n FROM receipts").get()).toEqual({ n: 0 });
    expect(fs.existsSync(path.join(receiptDir(), ".pending", `${sha256(pdf)}.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(receiptDir(), ".pending", `${sha256(pdf)}.rows.txt`))).toBe(true);
  });

  it("rejects the same file again without running OCR", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, pdf, deps([SMALL_RECEIPT]));
    const d = deps([SMALL_RECEIPT]);
    await expect(ingestReceipt(db, pdf, d)).rejects.toMatchObject({ code: "duplicate_receipt" });
    expect(d.scales).toEqual([]);
  });

  it("rejects the same ticket from a different scan, leaving no file behind", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, pdf, deps([SMALL_RECEIPT]));
    const other = Buffer.from("%PDF-1.4 rescanned");
    const run = ingestReceipt(db, other, deps([SMALL_RECEIPT]));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("duplicate_receipt");
      expect(e.message).toContain("2090-06514979");
    });
    expect(fs.existsSync(path.join(receiptDir(), `${sha256(other)}.pdf`))).toBe(false);
  });

  it("refuses non-PDF bytes and oversized uploads before doing anything", async () => {
    const db = openDb(":memory:");
    await expect(ingestReceipt(db, Buffer.from("PK.."), deps([]))).rejects.toMatchObject({ code: "not_pdf" });
    const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_RECEIPT_BYTES)]);
    await expect(ingestReceipt(db, huge, deps([]))).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("ingestCorrected", () => {
  it("stores the pending receipt from corrected text, keeping both transcripts", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, pdf, deps([BROKEN, BROKEN, BROKEN])).catch(() => undefined);
    const sha = sha256(pdf);
    const stored = await ingestCorrected(db, sha, BROKEN.replace("6490,00", "6400,00"));
    expect(stored).toMatchObject({ id: 1, totalCents: 2712097 });
    expect(db.prepare("SELECT transcript_source, ocr_scale FROM receipts").get()).toEqual({ transcript_source: "corrected", ocr_scale: 3 });
    expect(db.prepare("SELECT kind FROM receipt_transcripts ORDER BY kind").all()).toEqual([{ kind: "corrected" }, { kind: "ocr" }]);
    expect(fs.existsSync(path.join(receiptDir(), `${sha}.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(receiptDir(), ".pending", `${sha}.pdf`))).toBe(false);
  });

  it("rejects again when the corrected text still does not reconcile", async () => {
    const db = openDb(":memory:");
    await ingestReceipt(db, pdf, deps([BROKEN, BROKEN, BROKEN])).catch(() => undefined);
    await expect(ingestCorrected(db, sha256(pdf), BROKEN)).rejects.toBeInstanceOf(ReceiptRejected);
    expect(db.prepare("SELECT COUNT(*) n FROM receipts").get()).toEqual({ n: 0 });
  });

  it("fails cleanly for an unknown hash or empty text", async () => {
    const db = openDb(":memory:");
    await expect(ingestCorrected(db, "0".repeat(64), "TOTAL\t1,00")).rejects.toMatchObject({ code: "pending_missing" });
    await expect(ingestCorrected(db, "../etc/passwd", "x")).rejects.toMatchObject({ code: "pending_missing" });
    await ingestReceipt(db, pdf, deps([BROKEN, BROKEN, BROKEN])).catch(() => undefined);
    await expect(ingestCorrected(db, sha256(pdf), "\n\n")).rejects.toMatchObject({ code: "bad_rows" });
  });
});
