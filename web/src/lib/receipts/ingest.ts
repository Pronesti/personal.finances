import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { Failure } from "@/lib/failure";
import { REPO_ROOT } from "@/lib/upload";
import { renderPages, type PageImage } from "./pdf";
import { ocrPages, type Box } from "./ocr";
import { boxesToRows, parseRowsText, serializeRows, type Row } from "./rows";
import { parseRows, type ParsedReceipt } from "./parse";
import { verify, type VerificationReport } from "./verify";

// The largest receipt scanned so far is 17.7 MB (three tall page images).
export const MAX_RECEIPT_BYTES = 40 * 1024 * 1024;
// Vision reads the 3× upscale best; the smaller scales are the retries when it does not reconcile.
export const OCR_SCALES: readonly number[] = [3, 2, 1.5];

/** The two stages that touch the world, injectable so the orchestration tests need neither. */
export type ReceiptDeps = {
  renderPages: (pdf: Buffer, scale: number) => PageImage[];
  ocr: (pages: PageImage[]) => Promise<Box[]>;
};
const realDeps: ReceiptDeps = { renderPages, ocr: ocrPages };

export type ReceiptStored = { id: number; date: string; totalCents: number; items: number; report: VerificationReport };
export type ReceiptFailure = { report: VerificationReport; rowsText: string; sha256: string; scale: number };

/** Not a Failure: the payload is a report and a transcript to edit, not a message and a hint. */
export class ReceiptRejected extends Error {
  constructor(readonly payload: ReceiptFailure) {
    super("receipt did not reconcile");
    this.name = "ReceiptRejected";
  }
}

// Read at call time: the env override is the test seam, like pdfDir() in upload.ts.
export function receiptDir(): string {
  return process.env.TARJETAS_RECEIPT_DIR ?? path.join(REPO_ROOT, "pdfs", "receipts");
}
function pendingDir(): string {
  return path.join(receiptDir(), ".pending");
}
export function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

type Attempt = { rows: Row[]; parsed: ParsedReceipt; report: VerificationReport; scale: number };
function failing(report: VerificationReport): number {
  return report.errors.length + report.checks.filter(c => !c.ok).length;
}

/**
 * Bytes in, stored receipt out — or ReceiptRejected with the best attempt for the user to fix.
 * The name of the upload is not a parameter on purpose: nothing about a receipt is in its name.
 */
export async function ingestReceipt(
  db: Database.Database, bytes: Buffer, deps: ReceiptDeps = realDeps,
): Promise<ReceiptStored> {
  if (bytes.byteLength > MAX_RECEIPT_BYTES)
    throw new Failure("too_large", "failure.too_large", {
      name: "The receipt", size: (bytes.byteLength / 1024 / 1024).toFixed(1), limit: MAX_RECEIPT_BYTES / 1024 / 1024,
    });
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new Failure("not_pdf", "failure.not_pdf.magic", { name: "The upload" });
  const sha = sha256(bytes);
  const seen = db.prepare("SELECT id, date FROM receipts WHERE file_sha256 = ?").get(sha) as
    { id: number; date: string } | undefined;
  if (seen) throw new Failure("duplicate_receipt", "failure.duplicate_receipt.file", { id: seen.id, date: seen.date });

  let best: Attempt | null = null;
  for (const scale of OCR_SCALES) {
    const rows = boxesToRows(await deps.ocr(deps.renderPages(bytes, scale)));
    const parsed = parseRows(rows);
    const report = verify(parsed);
    if (report.ok)
      return storeReceipt(db, { parsed, report, sha, bytes, scale, transcripts: { ocr: serializeRows(rows) } });
    if (best === null || failing(report) < failing(best.report)) best = { rows, parsed, report, scale };
  }
  const attempt = best!;
  const rowsText = serializeRows(attempt.rows);
  fs.mkdirSync(pendingDir(), { recursive: true });
  fs.writeFileSync(path.join(pendingDir(), `${sha}.pdf`), bytes);
  fs.writeFileSync(path.join(pendingDir(), `${sha}.rows.txt`), rowsText);
  fs.writeFileSync(path.join(pendingDir(), `${sha}.meta.json`), JSON.stringify({ scale: attempt.scale }));
  throw new ReceiptRejected({ report: attempt.report, rowsText, sha256: sha, scale: attempt.scale });
}

const SHA_RE = /^[0-9a-f]{64}$/;

/** The user fixed the transcript by hand: same gate, same storage, both transcripts kept. */
export async function ingestCorrected(
  db: Database.Database, sha: string, rowsText: string,
): Promise<ReceiptStored> {
  const pdf = path.join(pendingDir(), `${sha}.pdf`);
  if (!SHA_RE.test(sha) || !fs.existsSync(pdf)) throw new Failure("pending_missing", "failure.pending_missing");
  const rows = parseRowsText(rowsText);
  if (rows.length === 0) throw new Failure("bad_rows", "failure.bad_rows");
  const parsed = parseRows(rows);
  const report = verify(parsed);
  const metaPath = path.join(pendingDir(), `${sha}.meta.json`);
  const scale = fs.existsSync(metaPath) ? (JSON.parse(fs.readFileSync(metaPath, "utf8")) as { scale: number }).scale : 0;
  if (!report.ok) throw new ReceiptRejected({ report, rowsText, sha256: sha, scale });
  const ocrPath = path.join(pendingDir(), `${sha}.rows.txt`);
  const ocrText = fs.existsSync(ocrPath) ? fs.readFileSync(ocrPath, "utf8") : rowsText;
  const stored = storeReceipt(db, {
    parsed, report, sha, bytes: fs.readFileSync(pdf), scale, transcripts: { ocr: ocrText, corrected: rowsText },
  });
  for (const f of [pdf, ocrPath, metaPath]) fs.rmSync(f, { force: true });
  return stored;
}

export type StoreInput = {
  parsed: ParsedReceipt;
  report: VerificationReport;
  sha: string;
  bytes: Buffer;
  scale: number;
  transcripts: { ocr: string; corrected?: string };
};

/** One transaction. The PDF lands first, named by its hash; a failed insert removes it again. */
export function storeReceipt(db: Database.Database, input: StoreInput): ReceiptStored {
  const { parsed, report, sha, bytes, scale, transcripts } = input;
  const h = parsed.header;
  const dup = db.prepare("SELECT id, date, fiscal_number FROM receipts WHERE fiscal_number = ? OR file_sha256 = ?")
    .get(h.fiscalNumber, sha) as { id: number; date: string; fiscal_number: string } | undefined;
  if (dup)
    throw new Failure("duplicate_receipt", "failure.duplicate_receipt.ticket", { fiscal: dup.fiscal_number, date: dup.date, id: dup.id });

  fs.mkdirSync(receiptDir(), { recursive: true });
  const filePath = path.join(receiptDir(), `${sha}.pdf`);
  fs.writeFileSync(filePath, bytes);

  const insert = db.transaction((): number => {
    const r = db.prepare(`
      INSERT INTO receipts (chain, branch_code, branch_name, date, time, fiscal_number, file_sha256, file_path,
        register, terminal, trx, cae, cae_due, payment_method, payment_ref,
        subtotal_cents, discounts_cents, total_cents, header_json, verification_json,
        transcript_source, ocr_scale, created_at)
      VALUES (@chain, @branch_code, @branch_name, @date, @time, @fiscal_number, @file_sha256, @file_path,
        @register, @terminal, @trx, @cae, @cae_due, @payment_method, @payment_ref,
        @subtotal_cents, @discounts_cents, @total_cents, @header_json, @verification_json,
        @transcript_source, @ocr_scale, @created_at)
    `).run({
      chain: "coto", branch_code: h.branchCode, branch_name: h.branchName, date: h.date, time: h.time,
      fiscal_number: h.fiscalNumber, file_sha256: sha, file_path: filePath,
      register: h.register, terminal: h.terminal, trx: h.trx, cae: h.cae, cae_due: h.caeDue,
      payment_method: h.paymentMethod, payment_ref: h.paymentRef,
      subtotal_cents: parsed.footer.subtotalCents, discounts_cents: parsed.footer.discountsCents,
      total_cents: parsed.footer.totalCents,
      header_json: JSON.stringify({
        cuit: h.cuit, paymentCents: h.paymentCents, savingsCents: parsed.footer.savingsCents,
        offers: parsed.footer.offers, notes: parsed.notes,
      }),
      verification_json: JSON.stringify(report),
      transcript_source: transcripts.corrected === undefined ? "ocr" : "corrected",
      ocr_scale: scale, created_at: new Date().toISOString(),
    });
    const id = Number(r.lastInsertRowid);
    const item = db.prepare(`
      INSERT INTO receipt_items (receipt_id, position, desc_printed, no_promo, sku, ean, qty_milli, unit, unit_price_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const discount = db.prepare(`
      INSERT INTO receipt_discounts (item_id, position, label, tag, amount_cents) VALUES (?, ?, ?, ?, ?)`);
    for (const it of parsed.items) {
      const ir = item.run(id, it.position, it.descPrinted, it.noPromo ? 1 : 0, it.sku, it.ean,
        it.qtyMilli, it.unit, it.unitPriceCents, it.lineTotalCents);
      it.discounts.forEach((d, j) => discount.run(Number(ir.lastInsertRowid), j + 1, d.label, d.tag, d.amountCents));
    }
    const transcript = db.prepare("INSERT INTO receipt_transcripts (receipt_id, kind, text) VALUES (?, ?, ?)");
    transcript.run(id, "ocr", transcripts.ocr);
    if (transcripts.corrected !== undefined) transcript.run(id, "corrected", transcripts.corrected);
    return id;
  });

  let id: number;
  try {
    id = insert();
  } catch (e) {
    fs.rmSync(filePath, { force: true });
    throw e;
  }
  // verify() guarantees these are non-null when report.ok, and storeReceipt is only reached then.
  return { id, date: h.date!, totalCents: parsed.footer.totalCents!, items: parsed.items.length, report };
}
