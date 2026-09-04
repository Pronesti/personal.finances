// Runs the real pipeline (mupdf + Apple Vision) over pdfs/receipts-acceptance/ and checks every
// receipt against the prototype's verified JSON. Gated: RECEIPT_ACCEPTANCE=1, macOS only.
// RECEIPT_RECORD=1 also writes each transcript to __fixtures__/rows/<date>.rows.txt, which
// replay.test.ts then exercises offline in the normal test run.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { REPO_ROOT } from "@/lib/upload";
import { ingestReceipt, ReceiptRejected } from "@/lib/receipts/ingest";
import { receiptList, receiptDetail, type ReceiptDetail } from "@/lib/receipts/queries";

type ExpectedItem = {
  desc: string; qty: number; unit_price: number | null; line_total: number; discount: number; discount_desc: string | null;
};
type Expected = { date: string; total_printed: number; items: ExpectedItem[] };

const enabled = process.env.RECEIPT_ACCEPTANCE === "1" && process.platform === "darwin";
const PDF_DIR = process.env.TARJETAS_RECEIPT_ACCEPTANCE_DIR ?? path.join(REPO_ROOT, "pdfs", "receipts-acceptance");
const FIXTURES = path.join(__dirname, "__fixtures__");
const TEN_MINUTES = 600_000;

const cents = (n: number) => Math.round(n * 100);

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const normDesc = (s: string) => s.replace(/^=/, "").replace(/\s+/g, " ").trim().toUpperCase();

// The printer's "?" stands for ñ/° and Vision reads it as anything; treat it as a wildcard.
function descMatches(expected: string, actual: string): boolean {
  const e = normDesc(expected), a = normDesc(actual);
  const pattern = new RegExp("^" + e.replace(/[.*+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, ".") + "$");
  if (pattern.test(a)) return true;
  const similarity = 1 - levenshtein(e, a) / Math.max(e.length, a.length, 1);
  return similarity >= 0.9;
}

describe.skipIf(!enabled)("receipt acceptance", () => {
  const pdfs = fs.existsSync(PDF_DIR) ? fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith(".pdf")).sort() : [];
  const expectedDir = path.join(FIXTURES, "expected");
  const expectedFiles = fs.existsSync(expectedDir) ? fs.readdirSync(expectedDir).filter(f => f.endsWith(".json")).sort() : [];
  // Set up in beforeAll, not at collection time: a skipped suite must not create temp dirs.
  let db: ReturnType<typeof openDb>;
  let sandbox = "";
  beforeAll(() => {
    db = openDb(":memory:");
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-acceptance-"));
    process.env.TARJETAS_RECEIPT_DIR = sandbox;
  });
  const byDate = new Map<string, ReceiptDetail>();
  const rejections: string[] = [];

  it("finds the PDFs and the expectations", () => {
    expect(pdfs.length, `no PDFs in ${PDF_DIR}`).toBeGreaterThan(0);
    expect(expectedFiles.length).toBe(pdfs.length);
  });

  it("ingests every PDF through the exact-cent gate", async () => {
    for (const f of pdfs) {
      const bytes = fs.readFileSync(path.join(PDF_DIR, f));
      try {
        const stored = await ingestReceipt(db, bytes);
        const detail = receiptDetail(db, stored.id)!;
        byDate.set(stored.date, detail);
        if (process.env.RECEIPT_RECORD === "1")
          fs.writeFileSync(path.join(FIXTURES, "rows", `${stored.date}.rows.txt`), detail.transcript);
      } catch (e) {
        if (!(e instanceof ReceiptRejected)) throw e;
        const failed = e.payload.report.checks.filter(c => !c.ok).map(c => `${c.name}: computed ${c.computed} printed ${c.printed}`);
        rejections.push(`${f} (scale ${e.payload.scale}): ${[...e.payload.report.errors, ...failed].join("; ")}`);
        fs.writeFileSync(path.join(sandbox, `${f}.rejected.rows.txt`), e.payload.rowsText);
      }
    }
    expect(rejections, `rejected transcripts saved under ${sandbox}`).toEqual([]);
    expect(receiptList(db)).toHaveLength(pdfs.length);
  }, TEN_MINUTES);

  for (const file of expectedFiles) {
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected", file), "utf8")) as Expected;
    it(`reproduces ${expected.date}`, () => {
      const got = byDate.get(expected.date);
      expect(got, `no stored receipt dated ${expected.date}`).toBeDefined();
      const { receipt, items, report } = got!;
      expect(report.ok).toBe(true);
      expect(receipt.total_cents).toBe(cents(expected.total_printed));
      expect(items.length).toBe(expected.items.length);
      expected.items.forEach((e, i) => {
        const a = items[i];
        const where = `item ${i + 1} "${e.desc}"`;
        expect(descMatches(e.desc, a.desc_printed), `${where}: read "${a.desc_printed}"`).toBe(true);
        expect(a.qty_milli, `${where} qty`).toBe(Math.round(e.qty * 1000));
        expect(a.line_total_cents, `${where} line total`).toBe(cents(e.line_total));
        if (e.unit_price !== null) expect(a.unit_price_cents, `${where} unit price`).toBe(cents(e.unit_price));
        else expect(a.unit_price_cents, `${where} unit price`).toBeNull();
        expect(a.discounts.reduce((s, d) => s + d.amount_cents, 0), `${where} discount`).toBe(cents(e.discount));
        for (const tag of ["M", "A"] as const) {
          const printed = (e.discount_desc ?? "").includes(`[${tag}]`);
          expect(a.discounts.some(d => d.tag === tag), `${where} tag ${tag}`).toBe(printed);
        }
        expect(a.sku, `${where} sku`).toMatch(/^\d{10}$/);
        expect(a.ean, `${where} ean`).toMatch(/^\d{12,14}$/);
      });
    });
  }
});
