# Supermarket Receipts P1 — Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload a scanned Coto receipt PDF, OCR it locally with Apple Vision, parse it, reconcile it to the cent against its printed totals, store it in the app database with a reconciliation report, and reject duplicates.

**Architecture:** A pure-Node pipeline in `web/src/lib/receipts/` (render pages with `mupdf` → OCR boxes from a small Python/pyobjc script → rows → deterministic parser → exact-cent verifier → SQLite rows), one route handler per upload shape, and two RSC pages. Every stage is a pure function with a text fixture except the two that touch the filesystem (render, OCR), which are injected so ingest tests stay hermetic. The five existing receipts are the acceptance suite.

**Tech Stack:** Next.js 16 (App Router, RSC, route handlers), TypeScript, better-sqlite3, vitest, Tailwind v4, `mupdf` 1.28, Python 3.13 + `pyobjc-framework-Vision` 12.2 (macOS Vision framework).

**Spec:** `docs/superpowers/specs/2026-09-04-supermarket-receipts.md` — read it first; every rule below is argued there.

## Global Constraints

- Node 20 via nvm (`web/.nvmrc`). Run `nvm use` before `npm`; Homebrew Node 25 breaks `better-sqlite3`.
- All commands below run from `web/` unless a path says otherwise. Repo root is `web/..`.
- Commit on the current branch (`dev`). Commit message body in plain English, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Identifiers, comments, commit messages in English. UI copy lives only in `web/src/lib/i18n.ts`, in **both** dictionaries, same placeholders in both; English is the default (`src/lib/i18n.test.ts` enforces this).
- Every route directory under `src/app` needs one entry in `CHROME` (`src/lib/chrome.ts`); pages render no `<h1>` (`src/lib/chrome.test.ts` enforces this).
- Money is `INTEGER` cents; quantity is `INTEGER` thousandths. Never `REAL` in the receipt tables.
- The uploaded file name is never read for anything. Date comes from the receipt; storage name is the sha256.
- OCR is Apple Vision through `scripts/ocr_receipt.py`: macOS only, no network, no API key. The Python child gets an env allowlist (never `process.env`).
- Verification gate is exact integer equality. A receipt that fails is not stored.
- Tests: `npm test` (vitest, `src/**/*.test.ts`) must stay green and fast: no real OCR, no real PDFs. The acceptance suite runs only under `RECEIPT_ACCEPTANCE=1`.
- The QR codes on the receipt are not read (decision 4 in the spec).

---

## File structure

Created:

| File | Responsibility |
|---|---|
| `web/src/lib/receipts/money.ts` | Argentine amount and quantity parsing to integers; cents formatting |
| `web/src/lib/receipts/pdf.ts` | PDF bytes → PNG per page at a scale (`mupdf`) |
| `web/src/lib/receipts/ocr.ts` | Spawn `scripts/ocr_receipt.py`; PNGs in, typed boxes out |
| `web/src/lib/receipts/rows.ts` | Boxes → rows; rows ↔ editable text |
| `web/src/lib/receipts/parse.ts` | Rows → `ParsedReceipt` (header, items, discounts, footer); page overlap merge |
| `web/src/lib/receipts/verify.ts` | `ParsedReceipt` → `VerificationReport` |
| `web/src/lib/receipts/ingest.ts` | Orchestration: scales, dedup, pending files, store; `ingestReceipt`, `ingestCorrected` |
| `web/src/lib/receipts/queries.ts` | `receiptList`, `receiptDetail` |
| `web/src/lib/receipts/__fixtures__/rows.ts` | Hand-written rows text of a small receipt |
| `web/src/lib/receipts/__fixtures__/expected/<date>.json` | The five prototype JSONs (acceptance expectations) |
| `web/src/lib/receipts/__fixtures__/rows/<date>.rows.txt` | Recorded OCR rows (written by the acceptance run) |
| `web/src/lib/receipts/acceptance.test.ts` | The gated acceptance suite |
| `web/src/app/api/receipts/route.ts` | `POST` upload |
| `web/src/app/api/receipts/corrected/route.ts` | `POST` corrected rows text |
| `web/src/app/receipts/page.tsx` | List + drop zone |
| `web/src/app/receipts/[id]/page.tsx` | Detail + report |
| `web/src/components/ReceiptDrop.tsx` | Client drop zone with the correction textarea |
| `scripts/ocr_receipt.py` (repo root) | Apple Vision OCR, JSON lines out |

Modified: `web/package.json`, `web/next.config.ts`, `requirements.txt` (root), `web/src/lib/db.ts`, `web/src/lib/db.test.ts`, `web/src/lib/failure.ts`, `web/src/lib/i18n.ts`, `web/src/lib/chrome.ts`, `web/src/components/Nav.tsx`, `web/README.md`.

Type names used across tasks (defined where marked, consumed everywhere else):

```ts
// pdf.ts
type PageImage = { page: number; png: Buffer; width: number; height: number };
// ocr.ts
type Box = { page: number; x: number; y: number; w: number; h: number; text: string };
// rows.ts
type Row = { page: number; label: string; amount: string | null };
// parse.ts
type DiscountLine = { label: string; tag: "M" | "A"; amountCents: number };
type ParsedItem = { position: number; descPrinted: string; noPromo: boolean; sku: string | null; ean: string | null;
  qtyMilli: number; unit: "un" | "kg"; unitPriceCents: number | null; lineTotalCents: number | null; discounts: DiscountLine[] };
type ParsedHeader = { date: string | null; time: string | null; branchName: string | null; branchCode: string | null;
  fiscalNumber: string | null; register: string | null; terminal: string | null; trx: string | null; cuit: string | null;
  cae: string | null; caeDue: string | null; paymentMethod: string | null; paymentRef: string | null; paymentCents: number | null };
type ParsedOffer = { label: string; amountCents: number | null };
type ParsedFooter = { subtotalCents: number | null; discountsCents: number | null; totalCents: number | null; savingsCents: number | null; offers: ParsedOffer[] };
type ParsedReceipt = { header: ParsedHeader; items: ParsedItem[]; footer: ParsedFooter; notes: string[] };
// verify.ts
type Check = { name: "subtotal" | "discounts" | "total"; computed: number; printed: number | null; ok: boolean };
type VerificationReport = { ok: boolean; checks: Check[]; offers: { label: string; printed: number | null; computed: number | null; ok: boolean }[]; warnings: string[]; errors: string[] };
// ingest.ts
type ReceiptStored = { id: number; date: string; totalCents: number; items: number; report: VerificationReport };
type ReceiptFailure = { report: VerificationReport; rowsText: string; sha256: string; scale: number };
```

---

### Task 1: Money and quantity parsing

**Files:**
- Create: `web/src/lib/receipts/money.ts`
- Test: `web/src/lib/receipts/money.test.ts`

**Interfaces:**
- Produces: `parseAmountCents(raw: string): number | null`, `isAmount(raw: string): boolean`, `parseQtyMilli(raw: string): number | null`, `fmtCents(cents: number): string` (Argentine `1.234,56`), `fmtArsCents(cents: number): string` (`$ 1.234,56`).

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/money.test.ts
import { describe, it, expect } from "vitest";
import { parseAmountCents, isAmount, parseQtyMilli, fmtCents, fmtArsCents } from "@/lib/receipts/money";

describe("parseAmountCents", () => {
  it("reads receipt amounts: decimal comma, no thousands separator", () => {
    expect(parseAmountCents("4454,63")).toBe(445463);
    expect(parseAmountCents("146931,91")).toBe(14693191);
    expect(parseAmountCents("0,00")).toBe(0);
  });
  it("reads negative discounts", () => {
    expect(parseAmountCents("-1336,39")).toBe(-133639);
    expect(parseAmountCents("−0,01")).toBe(-1); // unicode minus
  });
  it("tolerates thousands dots and OCR spaces", () => {
    expect(parseAmountCents("1.234,56")).toBe(123456);
    expect(parseAmountCents("3665 , 20")).toBe(366520);
    expect(parseAmountCents(" -916,30 ")).toBe(-91630);
  });
  it("rejects anything that is not exactly an amount", () => {
    for (const bad of ["5/65,00", "0,172 x 25899,00", "4454.63", "4454,6", "12", "", "[A]"]) {
      expect(parseAmountCents(bad), bad).toBeNull();
      expect(isAmount(bad), bad).toBe(false);
    }
  });
});

describe("parseQtyMilli", () => {
  it("reads kilograms with three decimals and unit counts", () => {
    expect(parseQtyMilli("0,172")).toBe(172);
    expect(parseQtyMilli("1,285")).toBe(1285);
    expect(parseQtyMilli("4,000")).toBe(4000);
    expect(parseQtyMilli("12,000")).toBe(12000);
  });
  it("rejects two-decimal and integer forms", () => {
    expect(parseQtyMilli("1,28")).toBeNull();
    expect(parseQtyMilli("4")).toBeNull();
  });
});

describe("formatting", () => {
  it("prints Argentine decimals", () => {
    expect(fmtCents(10972834)).toBe("109.728,34");
    expect(fmtCents(-133639)).toBe("-1.336,39");
    expect(fmtArsCents(10972834)).toMatch(/^\$\s?109\.728,34$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/money`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/receipts/money.ts
// Coto prints amounts with a decimal comma and no thousands separator ("146931,91"). Everything
// here is integer cents or integer thousandths: the verification gate compares integers, and a
// float that lands 0.004 off would fail a receipt that reconciles on paper.

const AMOUNT_RE = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/;
const QTY_RE = /^(\d+),(\d{3})$/;

function clean(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/^\$/, "");
}

/** "4454,63" → 445463; "-1336,39" → -133639; anything else → null. */
export function parseAmountCents(raw: string): number | null {
  const m = AMOUNT_RE.exec(clean(raw));
  if (!m) return null;
  const cents = Number(m[2].replace(/\./g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}

export function isAmount(raw: string): boolean {
  return parseAmountCents(raw) !== null;
}

/** "0,172" → 172 (kg in grams); "4,000" → 4000 (units in thousandths). Three decimals always. */
export function parseQtyMilli(raw: string): number | null {
  const m = QTY_RE.exec(clean(raw));
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}

const plain = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ars = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function fmtCents(cents: number): string {
  return plain.format(cents / 100);
}

/** Receipts are the one place the app shows cents: a gate that reconciles to the cent must show them. */
export function fmtArsCents(cents: number): string {
  return ars.format(cents / 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/money.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/money.ts src/lib/receipts/money.test.ts
git commit -m "feat(receipts): integer parsing of printed amounts and quantities"
```

---

### Task 2: PDF pages to PNG with mupdf

**Files:**
- Create: `web/src/lib/receipts/pdf.ts`
- Test: `web/src/lib/receipts/pdf.test.ts`
- Modify: `web/package.json` (dependencies), `web/next.config.ts`

**Interfaces:**
- Produces: `renderPages(pdf: Buffer, scale?: number): PageImage[]` with `PageImage = { page: number; png: Buffer; width: number; height: number }`; `page` is 1-based.

- [ ] **Step 1: Install the dependency**

```bash
npm install mupdf@^1.28.0
```

Then edit `web/next.config.ts` so Next loads the WASM package from `node_modules` at runtime instead of bundling it:

```ts
import type { NextConfig } from "next";
// better-sqlite3 is native and mupdf ships WebAssembly; neither survives being bundled, so Next
// requires them from node_modules at runtime.
const nextConfig: NextConfig = { serverExternalPackages: ["better-sqlite3", "mupdf"] };
export default nextConfig;
```

- [ ] **Step 2: Write the failing test**

```ts
// web/src/lib/receipts/pdf.test.ts
import { describe, it, expect } from "vitest";
import { renderPages } from "@/lib/receipts/pdf";

// A one-page PDF with a 100×200 pt page and no cross-reference table: mupdf repairs it and
// renders a blank page, which is all this test needs to check dimensions and scaling.
const MINI_PDF = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`);

describe("renderPages", () => {
  it("renders one PNG per page at the page's pixel size", () => {
    const pages = renderPages(MINI_PDF);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, width: 100, height: 200 });
    // PNG signature
    expect(pages[0].png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("scales the raster", () => {
    const [page] = renderPages(MINI_PDF, 3);
    expect(page.width).toBe(300);
    expect(page.height).toBe(600);
  });

  it("throws on bytes that are not a PDF", () => {
    expect(() => renderPages(Buffer.from("not a pdf"))).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/pdf.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/pdf`.

- [ ] **Step 4: Write the implementation**

```ts
// web/src/lib/receipts/pdf.ts
import * as mupdf from "mupdf";

export type PageImage = { page: number; png: Buffer; width: number; height: number };

/**
 * Every page of a receipt PDF as a PNG. The scans are stored as one tall image per page at 72
 * ppi, so scale 1 reproduces the embedded pixels and scale 3 is what Vision reads best.
 * Pure Node: mupdf is WebAssembly, no poppler on the machine required.
 */
export function renderPages(pdf: Buffer, scale = 1): PageImage[] {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    const out: PageImage[] = [];
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      try {
        // A matrix is six numbers; [s 0 0 s 0 0] scales both axes.
        const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
        try {
          out.push({
            page: i + 1,
            png: Buffer.from(pix.asPNG()),
            width: pix.getWidth(),
            height: pix.getHeight(),
          });
        } finally {
          pix.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return out;
  } finally {
    doc.destroy();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/pdf.test.ts`
Expected: PASS (3 tests). mupdf may print a "repairing PDF" warning to stderr; that is expected for the fixture.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts src/lib/receipts/pdf.ts src/lib/receipts/pdf.test.ts
git commit -m "feat(receipts): render receipt PDF pages to PNG with mupdf"
```

---

### Task 3: Apple Vision OCR script and its Node wrapper

**Files:**
- Create: `scripts/ocr_receipt.py` (repo root, beside `pdf_to_json.py`)
- Create: `web/src/lib/receipts/ocr.ts`
- Test: `web/src/lib/receipts/ocr.test.ts`
- Modify: `requirements.txt` (repo root), `web/src/lib/failure.ts`, `web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `PageImage` (Task 2); `resolvePython()` and `REPO_ROOT` from `@/lib/upload`; `Failure` from `@/lib/failure`.
- Produces: `ocrPages(pages: PageImage[]): Promise<Box[]>` with `Box = { page: number; x: number; y: number; w: number; h: number; text: string }` (fractions of the image, origin top-left, unordered). New `FailureCode`s: `"ocr_unavailable" | "ocr_failed"`. Env seam `TARJETAS_OCR_SCRIPT`.

- [ ] **Step 1: Add the Python dependency**

Append to `requirements.txt` (repo root):

```
pyobjc-framework-Vision==12.2.2 ; sys_platform == "darwin"
pyobjc-framework-Quartz==12.2.2 ; sys_platform == "darwin"
```

Then, from the repo root: `.venv/bin/pip install -r requirements.txt`.

- [ ] **Step 2: Write the OCR script**

```python
#!/usr/bin/env python3
"""
Apple Vision OCR for receipt scans.

Usage:
    ocr_receipt.py IMAGE [IMAGE...]

Output: one JSON object per recognised text box, one per line, in no particular order:
    {"page": 1, "x": 0.062, "y": 0.2376, "w": 0.31, "h": 0.009, "text": "VERDURAS GRILLADAS COTOX KG"}
x, y, w, h are fractions of the image; the origin is the top-left corner. `page` is the 1-based
position of the image in argv.

Exit codes: 0 ok; 2 an image could not be read or Vision failed on it; 3 Vision is not available
(not macOS, or the pyobjc frameworks are not installed) - the caller turns that into setup advice.

The receipt is Spanish, but language correction is OFF on purpose: it "fixes" product codes and
abbreviations into words. Recognition languages only steer the character set.
"""

from __future__ import annotations

import json
import sys

try:
    import Quartz
    import Vision
    from Foundation import NSURL
except ImportError as e:  # pragma: no cover - exercised only off macOS
    print(f"VISION UNAVAILABLE: {e}", file=sys.stderr)
    sys.exit(3)


def recognise(path: str, page: int):
    url = NSURL.fileURLWithPath_(path)
    source = Quartz.CGImageSourceCreateWithURL(url, None)
    if source is None:
        raise RuntimeError(f"cannot read image {path}")
    image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
    if image is None:
        raise RuntimeError(f"cannot decode image {path}")
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(False)
    request.setRecognitionLanguages_(["es-ES", "en-US"])
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)
    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"Vision failed on {path}: {error}")
    for observation in request.results() or []:
        candidates = observation.topCandidates_(1)
        if not candidates:
            continue
        box = observation.boundingBox()
        # Vision's origin is bottom-left; the parser thinks top-down like the receipt.
        yield {
            "page": page,
            "x": round(box.origin.x, 5),
            "y": round(1.0 - box.origin.y - box.size.height, 5),
            "w": round(box.size.width, 5),
            "h": round(box.size.height, 5),
            "text": candidates[0].string(),
        }


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: ocr_receipt.py IMAGE [IMAGE...]", file=sys.stderr)
        return 2
    for page, path in enumerate(argv, start=1):
        for box in recognise(path, page):
            print(json.dumps(box, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        print(f"READ ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
```

Smoke-test it by hand once (macOS): `../.venv/bin/python3 ../scripts/ocr_receipt.py /path/to/any.png | head -3` prints three JSON lines.

- [ ] **Step 3: Extend `Failure` codes and dictionaries**

In `web/src/lib/failure.ts`, extend the union:

```ts
export type FailureCode =
  | "bad_name" | "too_large" | "not_pdf"
  | "python_missing" | "parse_failed" | "ingest_failed"
  | "llm_unavailable" | "llm_failed"
  | "ocr_unavailable" | "ocr_failed" | "duplicate_receipt" | "pending_missing" | "bad_rows";
```

In `web/src/lib/i18n.ts`, add to `en` (next to the other `failure.*` keys) and to `es` in the same place:

```ts
  // en
  "failure.ocr_unavailable": "Apple Vision OCR is not available: {detail}",
  "failure.ocr_failed.timeout": "ocr_receipt.py timed out after {seconds}s.",
  "failure.ocr_failed.detail": "{detail}",
  "failure.duplicate_receipt.file": "This PDF was already uploaded: receipt of {date} (#{id}).",
  "failure.duplicate_receipt.ticket": "Receipt {fiscal} of {date} is already stored (#{id}).",
  "failure.pending_missing": "No pending upload matches that file. Upload the PDF again.",
  "failure.bad_rows": "The corrected text has no rows to read.",
  "hint.visionSetup": "Receipts are read with Apple Vision (macOS only). From the repo root: .venv/bin/pip install -r requirements.txt",
```

```ts
  // es
  "failure.ocr_unavailable": "El OCR de Apple Vision no está disponible: {detail}",
  "failure.ocr_failed.timeout": "ocr_receipt.py superó los {seconds}s.",
  "failure.ocr_failed.detail": "{detail}",
  "failure.duplicate_receipt.file": "Este PDF ya fue cargado: ticket del {date} (#{id}).",
  "failure.duplicate_receipt.ticket": "El ticket {fiscal} del {date} ya está guardado (#{id}).",
  "failure.pending_missing": "Ningún archivo pendiente coincide. Volvé a cargar el PDF.",
  "failure.bad_rows": "El texto corregido no tiene filas para leer.",
  "hint.visionSetup": "Los tickets se leen con Apple Vision (solo macOS). Desde la raíz del repo: .venv/bin/pip install -r requirements.txt",
```

Run `npx vitest run src/lib/i18n.test.ts` — must stay green (same keys, same placeholders in both).

- [ ] **Step 4: Write the failing test**

```ts
// web/src/lib/receipts/ocr.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ocrPages } from "@/lib/receipts/ocr";
import { Failure } from "@/lib/failure";

// Python stubs stand in for scripts/ocr_receipt.py: these tests never need Vision or a Mac.
let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  process.env.TARJETAS_PYTHON = "python3";
});
afterEach(() => {
  delete process.env.TARJETAS_PYTHON;
  delete process.env.TARJETAS_OCR_SCRIPT;
  fs.rmSync(sandbox, { recursive: true, force: true });
});
function useStub(body: string): void {
  const p = path.join(sandbox, "stub.py");
  fs.writeFileSync(p, body);
  process.env.TARJETAS_OCR_SCRIPT = p;
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pages = [{ page: 1, png, width: 10, height: 10 }, { page: 2, png, width: 10, height: 10 }];

const ECHO_PAGES = `
import sys, json, os
for page, p in enumerate(sys.argv[1:], start=1):
    assert os.path.exists(p), p
    print(json.dumps({"page": page, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.01, "text": "TOTAL"}))
`;

describe("ocrPages", () => {
  it("writes one PNG per page, calls the script with all of them, parses JSON lines", async () => {
    useStub(ECHO_PAGES);
    const boxes = await ocrPages(pages);
    expect(boxes).toEqual([
      { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.01, text: "TOTAL" },
      { page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.01, text: "TOTAL" },
    ]);
  });

  it("cleans up the temp images", async () => {
    useStub(`
import sys, pathlib
pathlib.Path(sys.argv[1]).with_name("seen.txt").write_text(str(pathlib.Path(sys.argv[1]).parent))
`);
    await ocrPages(pages.slice(0, 1));
    // The stub recorded its temp dir; by now it must be gone.
    const dirs = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith("receipt-ocr-"));
    expect(dirs).toEqual([]);
  });

  it("reports exit 3 as ocr_unavailable with the setup hint", async () => {
    useStub(`import sys; print("VISION UNAVAILABLE: No module named 'Vision'", file=sys.stderr); sys.exit(3)`);
    const run = ocrPages(pages);
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("ocr_unavailable");
      expect(e.hint).toContain("pip install");
    });
  });

  it("reports exit 2 as ocr_failed quoting stderr", async () => {
    useStub(`import sys; print("READ ERROR: RuntimeError: cannot read image", file=sys.stderr); sys.exit(2)`);
    await ocrPages(pages).catch((e: Failure) => {
      expect(e.code).toBe("ocr_failed");
      expect(e.message).toContain("cannot read image");
    });
  });

  it("does not hand the API key to the subprocess", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    useStub(`
import os, json
print(json.dumps({"page": 1, "x": 0, "y": 0, "w": 0, "h": 0, "text": "leaked" if "ANTHROPIC_API_KEY" in os.environ else "clean"}))
`);
    const [box] = await ocrPages(pages.slice(0, 1));
    delete process.env.ANTHROPIC_API_KEY;
    expect(box.text).toBe("clean");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/ocr.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/ocr`.

- [ ] **Step 6: Write the implementation**

```ts
// web/src/lib/receipts/ocr.ts
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Failure } from "@/lib/failure";
import { REPO_ROOT, resolvePython } from "@/lib/upload";
import type { PageImage } from "./pdf";

const execFileP = promisify(execFile);

/** One recognised text box. Fractions of the page image, origin top-left. Unordered. */
export type Box = { page: number; x: number; y: number; w: number; h: number; text: string };

const TIMEOUT_MS = 180_000;

function script(): string {
  return process.env.TARJETAS_OCR_SCRIPT ?? path.join(REPO_ROOT, "scripts", "ocr_receipt.py");
}

function tail(s: string, n = 3): string {
  return s.split("\n").map(l => l.trim()).filter(Boolean).slice(-n).join(" — ");
}

/**
 * Apple Vision, through scripts/ocr_receipt.py in the same venv the statement pipeline uses.
 * The pages go through a temp directory because Vision reads files; it is removed whatever
 * happens. Same env allowlist as runPipeline: the child never sees ANTHROPIC_API_KEY.
 */
export async function ocrPages(pages: PageImage[]): Promise<Box[]> {
  const python = resolvePython();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-ocr-"));
  try {
    const files = pages.map(p => {
      const file = path.join(dir, `page-${p.page}.png`);
      fs.writeFileSync(file, p.png);
      return file;
    });
    let stdout: string;
    try {
      ({ stdout } = await execFileP(python, [script(), ...files], {
        cwd: REPO_ROOT,
        timeout: TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          LC_ALL: "C.UTF-8",
        },
      }));
    } catch (e) {
      const err = e as { stderr?: string; message: string; code?: string | number; killed?: boolean };
      const stderr = tail(err.stderr ?? "");
      if (err.code === "ENOENT")
        throw new Failure("python_missing", "failure.python_missing.cannotRun", { python }, "hint.pythonSetup");
      if (err.code === 3 || stderr.includes("VISION UNAVAILABLE"))
        throw new Failure("ocr_unavailable", "failure.ocr_unavailable", { detail: stderr }, "hint.visionSetup");
      if (err.killed)
        throw new Failure("ocr_failed", "failure.ocr_failed.timeout", { seconds: TIMEOUT_MS / 1000 });
      throw new Failure("ocr_failed", "failure.ocr_failed.detail", { detail: stderr || err.message });
    }
    return stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line) as Box);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/ocr.test.ts src/lib/i18n.test.ts`
Expected: PASS (5 + existing i18n tests).

- [ ] **Step 8: Commit**

```bash
git add ../scripts/ocr_receipt.py ../requirements.txt src/lib/receipts/ocr.ts src/lib/receipts/ocr.test.ts src/lib/failure.ts src/lib/i18n.ts
git commit -m "feat(receipts): Apple Vision OCR script and its Node wrapper"
```

---

### Task 4: Boxes to rows, rows to editable text

**Files:**
- Create: `web/src/lib/receipts/rows.ts`
- Test: `web/src/lib/receipts/rows.test.ts`

**Interfaces:**
- Consumes: `Box` (Task 3), `isAmount` (Task 1).
- Produces: `Row = { page: number; label: string; amount: string | null }`; `boxesToRows(boxes: Box[]): Row[]`; `serializeRows(rows: Row[]): string`; `parseRowsText(text: string): Row[]`.

Rows text format (the transcript a user edits): one row per line, `label<TAB>amount`; a row that is only an amount starts with a tab; `## page N` starts a page. When reading back, a tab **or two or more spaces** before an amount-shaped tail both count as the separator.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/rows.test.ts
import { describe, it, expect } from "vitest";
import { boxesToRows, serializeRows, parseRowsText, type Row } from "@/lib/receipts/rows";
import type { Box } from "@/lib/receipts/ocr";

// Real Vision output for one item of the 2026-09-04 receipt (page fractions, origin top-left).
// The large-font line total sits on the code row; the [A] tag is its own box mid-row.
const boxes: Box[] = [
  { page: 1, x: 0.117, y: 0.2197, w: 0.30, h: 0.008, text: "0,172 x 25899,00" },
  { page: 1, x: 0.063, y: 0.2286, w: 0.55, h: 0.008, text: "VERDURAS GRILLADAS COTOX KG" },
  { page: 1, x: 0.696, y: 0.2368, w: 0.22, h: 0.011, text: "4454,63" },
  { page: 1, x: 0.062, y: 0.2376, w: 0.48, h: 0.008, text: "0000038072 02538072001727" },
  { page: 1, x: 0.062, y: 0.2467, w: 0.31, h: 0.008, text: "1 *30% ELABORADOS" },
  { page: 1, x: 0.471, y: 0.2467, w: 0.04, h: 0.008, text: "[A]" },
  { page: 1, x: 0.808, y: 0.2467, w: 0.11, h: 0.008, text: "-1336,39" },
  // second page, deliberately out of order in the input
  { page: 2, x: 0.700, y: 0.0500, w: 0.20, h: 0.011, text: "27120,97" },
  { page: 2, x: 0.060, y: 0.0505, w: 0.20, h: 0.008, text: "TOTAL" },
];

describe("boxesToRows", () => {
  it("groups boxes by line, joins labels left to right, pulls the amount out", () => {
    expect(boxesToRows(boxes)).toEqual<Row[]>([
      { page: 1, label: "0,172 x 25899,00", amount: null },
      { page: 1, label: "VERDURAS GRILLADAS COTOX KG", amount: null },
      { page: 1, label: "0000038072 02538072001727", amount: "4454,63" },
      { page: 1, label: "1 *30% ELABORADOS [A]", amount: "-1336,39" },
      { page: 2, label: "TOTAL", amount: "27120,97" },
    ]);
  });

  it("does not mistake a left-column number for the amount", () => {
    const rows = boxesToRows([
      { page: 1, x: 0.06, y: 0.5, w: 0.1, h: 0.008, text: "3172,00" },
      { page: 1, x: 0.30, y: 0.5, w: 0.2, h: 0.008, text: "SAL FINA" },
    ]);
    expect(rows).toEqual([{ page: 1, label: "3172,00 SAL FINA", amount: null }]);
  });

  it("returns nothing for no boxes", () => {
    expect(boxesToRows([])).toEqual([]);
  });
});

describe("rows text", () => {
  const rows: Row[] = [
    { page: 1, label: "TOTAL", amount: "109728,34" },
    { page: 1, label: "", amount: "21950,00" },
    { page: 2, label: "SU VUELTO", amount: "0,00" },
    { page: 2, label: "ART:040 TRX:4969", amount: null },
  ];

  it("round-trips", () => {
    const text = serializeRows(rows);
    expect(text).toBe("## page 1\nTOTAL\t109728,34\n\t21950,00\n## page 2\nSU VUELTO\t0,00\nART:040 TRX:4969\n");
    expect(parseRowsText(text)).toEqual(rows);
  });

  it("accepts two spaces instead of a tab, and Windows line endings", () => {
    expect(parseRowsText("TOTAL   109728,34\r\nART:040  TRX:4969\r\n")).toEqual([
      { page: 1, label: "TOTAL", amount: "109728,34" },
      { page: 1, label: "ART:040  TRX:4969", amount: null }, // not amount-shaped: stays in the label
    ]);
  });

  it("skips blank lines", () => {
    expect(parseRowsText("\n\n## page 3\n\nX\n")).toEqual([{ page: 3, label: "X", amount: null }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/rows.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/rows`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/receipts/rows.ts
import { isAmount } from "./money";
import type { Box } from "./ocr";

/** One printed line: what is on the left, and the amount on the right if there is one. */
export type Row = { page: number; label: string; amount: string | null };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Vision returns boxes in no order and splits a printed line into two or three of them (label,
 * tag, amount). Boxes whose vertical centres sit within 0.6 median box heights of the row's
 * first box are one row. The amount is the rightmost amount-shaped box in the right half of the
 * page: line totals and discounts are right-aligned, and nothing else there looks like money.
 */
export function boxesToRows(boxes: Box[]): Row[] {
  const rows: Row[] = [];
  const pages = [...new Set(boxes.map(b => b.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const sorted = boxes.filter(b => b.page === page)
      .map(b => ({ ...b, cy: b.y + b.h / 2 }))
      .sort((a, b) => a.cy - b.cy);
    const tolerance = median(sorted.map(b => b.h)) * 0.6;
    let group: typeof sorted = [];
    const flush = () => {
      if (group.length === 0) return;
      const byX = [...group].sort((a, b) => a.x - b.x);
      let amountAt = -1;
      for (let i = byX.length - 1; i >= 0; i--) {
        if (byX[i].x >= 0.5 && isAmount(byX[i].text)) { amountAt = i; break; }
      }
      const label = byX.filter((_, i) => i !== amountAt).map(b => b.text.trim()).join(" ")
        .replace(/\s+/g, " ").trim();
      rows.push({ page, label, amount: amountAt >= 0 ? byX[amountAt].text.replace(/\s+/g, "") : null });
      group = [];
    };
    for (const box of sorted) {
      if (group.length > 0 && box.cy - group[0].cy > tolerance) flush();
      group.push(box);
    }
    flush();
  }
  return rows;
}

export function serializeRows(rows: Row[]): string {
  const out: string[] = [];
  let page = 0;
  for (const r of rows) {
    if (r.page !== page) { page = r.page; out.push(`## page ${page}`); }
    out.push(r.amount === null ? r.label : `${r.label}\t${r.amount}`);
  }
  return out.join("\n") + "\n";
}

const PAGE_LINE = /^## page (\d+)$/;
// A tail that is an amount after two or more spaces: the textarea has no tab key.
const SPACED_AMOUNT = /^(.*?)\s{2,}(-?[\d.]+,\d{2})$/;

export function parseRowsText(text: string): Row[] {
  const rows: Row[] = [];
  let page = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const pm = PAGE_LINE.exec(line.trim());
    if (pm) { page = Number(pm[1]); continue; }
    const tab = line.lastIndexOf("\t");
    if (tab >= 0) {
      const amount = line.slice(tab + 1).trim();
      rows.push({ page, label: line.slice(0, tab).trim(), amount: amount || null });
      continue;
    }
    const sm = SPACED_AMOUNT.exec(line);
    if (sm && isAmount(sm[2])) rows.push({ page, label: sm[1].trim(), amount: sm[2] });
    else rows.push({ page, label: line.trim(), amount: null });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/rows.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/rows.ts src/lib/receipts/rows.test.ts
git commit -m "feat(receipts): group OCR boxes into rows and an editable transcript"
```

---

### Task 5: The parser — rows to a receipt

**Files:**
- Create: `web/src/lib/receipts/parse.ts`
- Create: `web/src/lib/receipts/__fixtures__/rows.ts`
- Test: `web/src/lib/receipts/parse.test.ts`

**Interfaces:**
- Consumes: `Row`, `parseRowsText` (Task 4); `parseAmountCents`, `parseQtyMilli` (Task 1).
- Produces: `parseRows(rows: Row[]): ParsedReceipt` (runs `mergePages` first); `mergePages(rows: Row[]): Row[]`; the types `DiscountLine`, `ParsedItem`, `ParsedHeader`, `ParsedOffer`, `ParsedFooter`, `ParsedReceipt` exactly as in the type table at the top of this plan.

Read spec §5 before writing: it lists every printed line shape the state machine below handles.

- [ ] **Step 1: Write the fixture**

A six-item receipt in rows text. Page 2 repeats the last item of page 1 (the scan overlap) and its offers section prints the amounts one row late, as the real 2026-09-04 scan does. The numbers reconcile: line totals sum to 35596,26; discounts to −8475,29; total 27120,97.

```ts
// web/src/lib/receipts/__fixtures__/rows.ts
export const SMALL_RECEIPT = `## page 1
COTO
SUC 90 COTO CICSA
SEGUROLA 1743
CUIT:30-54808315-6 INGRESOS BRUTOS:901-923274-2
04/09/2026 09:42:15 NRO.T.:2090-06514979
NRO.CAJA:0012 NRO.TERM:3791 NRO.TRAN:4969
FACTURA B
ORIGINAL (Cod.006)
0,172 x 25899,00
VERDURAS GRILLADAS COTOX KG
0000038072 02538072001727\t4454,63
1 *30% ELABORADOS [A]\t-1336,39
0,212 x 21319,00
PESCADO FILET A LA ROMANACOTO X KG
0000000726 02500726002121\t4519,63
1 *PESCADO 30% [A]\t-1355,89
MERCADO PAGO 25% - V [M]\t-0,01
CHORIZO PARRILLEROX 320GR DOINA
0000014718 07798140550143\t6400,00
MERCADO PAGO 25% - V [M]\t-1600,00
=HUEVO BLANCOCJA 12 UNI
0000022865 07793618000083\t3490,00
4,000 x 3390,00
AGUA SIN GAS V.D.S LEVITE CEROPOMELO BOT 2.25 LT
0000255634 07790315001047\t13560,00
## page 2
0000255634 07790315001047\t13560,00
MERCADO PAGO 25% - V [M]\t-3390,00
SAL FINA CELUSALSAL 250 GRM
0000051732 00000077955262\t3172,00
MERCADO PAGO 25% - V [M]\t-793,00
SUBTOT. SIN DESCUENTOS\t35596,26
DESCUENTOS POR PROMOCIONES\t-8475,29
TOTAL\t27120,97
MERCADO PAG 177204174592\t27120,97
SU VUELTO\t0,00
ART:006 TRX:4969 EMP:123859-SORIA
DETALLE DE OFERTAS APLICADAS
1 *30% ELABORADOS
1 *PESCADO 30%\t1336,39
MERCADO PAGO 25% - V\t1355,89
\t5783,01
TOT.AHORRO\t8475,29
C.A.E.Nro.:86361418114640 Vto.:20260914
`;
```

Note what the fixture exercises: page 1 ends after the LEVITE code row and page 2 starts with that same code row plus the discount page 1 never got (the merge must keep page 2's copy); `=HUEVO` is a no-promotion item with no quantity line; in the offers section the amounts print one row late (the last one alone, just above `TOT.AHORRO`), exactly as the 2026-09-04 scan does.

- [ ] **Step 2: Write the failing test**

```ts
// web/src/lib/receipts/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseRows, mergePages } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

const parsed = () => parseRows(parseRowsText(SMALL_RECEIPT));

describe("parseRows: header", () => {
  it("reads date, time, identity and branch", () => {
    const { header } = parsed();
    expect(header).toMatchObject({
      date: "2026-09-04", time: "09:42:15", fiscalNumber: "2090-06514979",
      register: "0012", terminal: "3791", trx: "4969",
      branchCode: "090", branchName: "SUC 90 COTO CICSA", cuit: "30-54808315-6",
      cae: "86361418114640", caeDue: "2026-09-14",
      paymentMethod: "MERCADO PAG", paymentRef: "177204174592", paymentCents: 2712097,
    });
  });
  it("tolerates the OCR spellings of the ticket number line", () => {
    const rows = parseRowsText("04/09/2026 09:42:15 NRO.1.:2090-06514979\nNRO, TERM: 3791\n");
    expect(parseRows(rows).header).toMatchObject({ fiscalNumber: "2090-06514979", terminal: "3791" });
  });
});

describe("parseRows: items", () => {
  it("builds one item per code line, in printed order, with the page overlap removed", () => {
    const { items } = parsed();
    expect(items.map(i => i.sku)).toEqual([
      "0000038072", "0000000726", "0000014718", "0000022865", "0000255634", "0000051732",
    ]);
    expect(items.map(i => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads a weighed item: kg, three-decimal quantity, printed unit price", () => {
    const [verduras] = parsed().items;
    expect(verduras).toMatchObject({
      descPrinted: "VERDURAS GRILLADAS COTOX KG", noPromo: false, ean: "02538072001727",
      qtyMilli: 172, unit: "kg", unitPriceCents: 2589900, lineTotalCents: 445463,
      discounts: [{ label: "1 *30% ELABORADOS", tag: "A", amountCents: -133639 }],
    });
  });

  it("attaches several discount lines to one item", () => {
    const pescado = parsed().items[1];
    expect(pescado.discounts).toEqual([
      { label: "1 *PESCADO 30%", tag: "A", amountCents: -135589 },
      { label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -1 },
    ]);
  });

  it("reads a unit item with no quantity line as one unit and no unit price", () => {
    const chorizo = parsed().items[2];
    expect(chorizo).toMatchObject({ qtyMilli: 1000, unit: "un", unitPriceCents: null, lineTotalCents: 640000 });
  });

  it("keeps the '=' prefix and flags no_promo", () => {
    const huevo = parsed().items[3];
    expect(huevo).toMatchObject({ descPrinted: "=HUEVO BLANCOCJA 12 UNI", noPromo: true, discounts: [] });
  });

  it("reads a multi-unit item: units in thousandths", () => {
    const levite = parsed().items[4];
    expect(levite).toMatchObject({ qtyMilli: 4000, unit: "un", unitPriceCents: 339000, lineTotalCents: 1356000 });
    expect(levite.discounts).toEqual([{ label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -339000 }]);
  });

  it("normalises an OCR '-' or '−' marker to '='", () => {
    const rows = parseRowsText("-ACEITE GIRASOL\n0000163580 07790272001005\t4406,00\n");
    expect(parseRows(rows).items[0]).toMatchObject({ descPrinted: "=ACEITE GIRASOL", noPromo: true });
  });

  it("takes a line total that landed on the description row", () => {
    const rows = parseRowsText("1,072 x 2299,00\n=BANANA CAVENDISHX KG\t2464,53\n0000000446 02500446010727\n");
    expect(parseRows(rows).items[0]).toMatchObject({ lineTotalCents: 246453, qtyMilli: 1072, unit: "kg" });
  });

  it("takes a line total that landed on its own row after the code", () => {
    const rows = parseRowsText("PISI\n0000012345 07790000000001\n\t21950,00\n1 *25% MARCAS [A]\t-5487,50\n");
    expect(parseRows(rows).items[0]).toMatchObject({ lineTotalCents: 2195000, discounts: [{ amountCents: -548750 }] });
  });

  it("accepts OCR variants of the tag", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\n1 *PESCADO 30% LA]\t-0,30\nMERCADO PAGO (M)\t-0,10\n");
    expect(parseRows(rows).items[0].discounts.map(d => d.tag)).toEqual(["A", "M"]);
  });

  it("leaves an item without a line total as null and notes it", () => {
    const r = parseRows(parseRowsText("X\n0000000001 000000000001\nSUBTOT. SIN DESCUENTOS\t0,00\n"));
    expect(r.items[0].lineTotalCents).toBeNull();
    expect(r.notes.join(" ")).toContain("line total");
  });
});

describe("parseRows: footer", () => {
  it("reads the three totals and the savings line", () => {
    const { footer } = parsed();
    expect(footer).toMatchObject({
      subtotalCents: 3559626, discountsCents: -847529, totalCents: 2712097, savingsCents: 847529,
    });
  });
  it("pairs offer labels with amounts by order, surviving the row offset", () => {
    expect(parsed().footer.offers).toEqual([
      { label: "1 *30% ELABORADOS", amountCents: 133639 },
      { label: "1 *PESCADO 30%", amountCents: 135589 },
      { label: "MERCADO PAGO 25% - V", amountCents: 578301 },
    ]);
  });
});

describe("mergePages", () => {
  const rows = (s: string) => parseRowsText(s);
  it("drops the run of items page 2 repeats from the end of page 1", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\nB\n0000000002 000000000002\t2,00\n" +
      "## page 2\nB\n0000000002 000000000002\t2,00\nC\n0000000003 000000000003\t3,00\n"));
    expect(merged.filter(r => /^\d{10} /.test(r.label)).map(r => r.label.slice(0, 10)))
      .toEqual(["0000000001", "0000000002", "0000000003"]);
  });
  it("keeps page 2's copy of the last duplicated item when it has the discount rows", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n" +
      "## page 2\n0000000001 000000000001\t1,00\nPROMO [A]\t-0,50\nB\n0000000002 000000000002\t2,00\n"));
    expect(merged.map(r => r.label)).toEqual([
      "A", "0000000001 000000000001", "PROMO [A]", "B", "0000000002 000000000002",
    ]);
  });
  it("matches anchors on the EAN when the article code was misread", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n" +
      "## page 2\n0000000007 000000000001\t1,00\nB\n0000000002 000000000002\t2,00\n"));
    expect(merged.filter(r => /^\d{10} /.test(r.label))).toHaveLength(2);
  });
  it("concatenates pages that do not overlap", () => {
    const merged = mergePages(rows("## page 1\nA\n0000000001 000000000001\t1,00\n## page 2\nTOTAL\t1,00\n"));
    expect(merged).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/parse.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/parse`.

- [ ] **Step 4: Write the implementation**

```ts
// web/src/lib/receipts/parse.ts
import { parseAmountCents, parseQtyMilli } from "./money";
import type { Row } from "./rows";

export type DiscountLine = { label: string; tag: "M" | "A"; amountCents: number };
export type ParsedItem = {
  position: number;
  descPrinted: string;
  noPromo: boolean;
  sku: string | null;
  ean: string | null;
  qtyMilli: number;
  unit: "un" | "kg";
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  discounts: DiscountLine[];
};
export type ParsedHeader = {
  date: string | null; time: string | null;
  branchName: string | null; branchCode: string | null;
  fiscalNumber: string | null; register: string | null; terminal: string | null; trx: string | null;
  cuit: string | null; cae: string | null; caeDue: string | null;
  paymentMethod: string | null; paymentRef: string | null; paymentCents: number | null;
};
export type ParsedOffer = { label: string; amountCents: number | null };
export type ParsedFooter = {
  subtotalCents: number | null; discountsCents: number | null; totalCents: number | null;
  savingsCents: number | null; offers: ParsedOffer[];
};
export type ParsedReceipt = { header: ParsedHeader; items: ParsedItem[]; footer: ParsedFooter; notes: string[] };

// Line shapes, in the order the state machine tests them. Vision writes the multiplication sign
// as x, ×, or the Cyrillic х; the tag brackets come back as [A], LA], (M) and worse.
const QTY_RE = /^(\d+,\d{3})\s*[xX×хХ]\s*(-?\d[\d.]*,\d{2})$/;
export const CODE_RE = /^(\d{10})\s+(\d{12,14})$/;
// The L/I readings of "[" only count after a space, or FRUTILLA and SANDIA would end in a tag.
export const TAG_RE = /(?:\[|\(|\||\s[LI])\s*([AM])\s*[\])|]?\s*$/;
const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const FISCAL_RE = /NRO\.?\s*[TI1l]\.?\s*:?\s*(\d{4}-\d{8})/i;
const REGISTER_RE = /NRO[.,]?\s*CAJA\s*:?\s*(\d+)/i;
const TERMINAL_RE = /NRO[.,]?\s*TERM\s*:?\s*(\d+)/i;
const TRX_RE = /NRO[.,]?\s*TRAN\s*:?\s*(\d+)/i;
const BRANCH_RE = /^SUC\s+(\d+)\b/i;
const CUIT_RE = /CUIT\s*:?\s*(\d{2}-\d{8}-\d)/i;
const CAE_RE = /C\.?A\.?E\.?\s*N\S*\s*:?\s*(\d{14}).*?V\S*\s*:?\s*(\d{4})(\d{2})(\d{2})/i;
const PAYMENT_RE = /^(MERCADO PAG\w*)\s+(\d{6,})$/i;
const KG_RE = /X\s?KG\b|XKG|\bKGM\b/;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function emptyHeader(): ParsedHeader {
  return {
    date: null, time: null, branchName: null, branchCode: null, fiscalNumber: null, register: null,
    terminal: null, trx: null, cuit: null, cae: null, caeDue: null, paymentMethod: null,
    paymentRef: null, paymentCents: null,
  };
}

/** Header facts can sit on any row (the CAE is in the footer); the first reading wins. */
function scanHeader(label: string, h: ParsedHeader): void {
  const d = DATE_RE.exec(label);
  if (d && !h.date) { h.date = `${d[3]}-${d[2]}-${d[1]}`; h.time = `${d[4]}:${d[5]}:${d[6]}`; }
  const f = FISCAL_RE.exec(label);
  if (f && !h.fiscalNumber) h.fiscalNumber = f[1];
  const r = REGISTER_RE.exec(label);
  if (r && !h.register) h.register = r[1];
  const t = TERMINAL_RE.exec(label);
  if (t && !h.terminal) h.terminal = t[1];
  const x = TRX_RE.exec(label);
  if (x && !h.trx) h.trx = x[1];
  const b = BRANCH_RE.exec(label);
  if (b && !h.branchCode) { h.branchCode = b[1].padStart(3, "0"); h.branchName = label; }
  const c = CUIT_RE.exec(label);
  if (c && !h.cuit) h.cuit = c[1];
  const e = CAE_RE.exec(label);
  if (e && !h.cae) { h.cae = e[1]; h.caeDue = `${e[2]}-${e[3]}-${e[4]}`; }
}

function codeOf(row: Row): { sku: string; ean: string } | null {
  const m = CODE_RE.exec(norm(row.label));
  return m ? { sku: m[1], ean: m[2] } : null;
}

/**
 * The scans overlap: page k+1 starts with lines already on page k. Code lines are the anchors —
 * every item has exactly one — so the longest run of codes that ends page k and starts page k+1
 * is the duplicated stretch. Page k+1 loses it, except that the last duplicated item keeps
 * whichever copy carries more discount rows: the page break can fall between an item and its
 * discounts, leaving them on one page only.
 */
export function mergePages(rows: Row[]): Row[] {
  const pageNumbers = [...new Set(rows.map(r => r.page))].sort((a, b) => a - b);
  const pages = pageNumbers.map(p => rows.filter(r => r.page === p));
  let merged: Row[] = pages[0] ?? [];
  for (const next of pages.slice(1)) {
    const a = merged.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const b = next.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const same = (p: { sku: string; ean: string }, q: { sku: string; ean: string }) =>
      p.sku === q.sku || p.ean === q.ean;
    let k = 0;
    for (let n = Math.min(a.length, b.length); n >= 1; n--) {
      const tailA = a.slice(-n), headB = b.slice(0, n);
      if (tailA.every((x, j) => same(x.code!, headB[j].code!))) { k = n; break; }
    }
    if (k === 0) { merged = merged.concat(next); continue; }
    const isTrailer = (r: Row) => TAG_RE.test(norm(r.label)) || (r.label.trim() === "" && r.amount !== null);
    // Rows of page k+1 that belong to its k-th duplicated item: its code row and what trails it.
    let end = b[k - 1].i + 1;
    while (end < next.length && isTrailer(next[end])) end++;
    const lastCodeA = a[a.length - 1].i;
    const tailA = merged.slice(lastCodeA + 1);
    const tailB = next.slice(b[k - 1].i + 1, end);
    const discounts = (rs: Row[]) => rs.filter(r => TAG_RE.test(norm(r.label))).length;
    const keptTail = discounts(tailB) > discounts(tailA) ? tailB : tailA;
    merged = merged.slice(0, lastCodeA + 1).concat(keptTail, next.slice(end));
  }
  return merged;
}

/**
 * One pass over the rows. An item is born at its code line, takes the label row just above it
 * as its description and the quantity line above that (if any) as its quantity, and then owns
 * every discount row until the next quantity line, code line or footer marker.
 */
export function parseRows(input: Row[]): ParsedReceipt {
  const rows = mergePages(input);
  const header = emptyHeader();
  const footer: ParsedFooter = { subtotalCents: null, discountsCents: null, totalCents: null, savingsCents: null, offers: [] };
  const items: ParsedItem[] = [];
  const notes: string[] = [];
  let pending: { qtyMilli: number; unitPriceCents: number } | null = null;
  let candidate: Row | null = null;     // the last unclassified label row: the next description
  let current: ParsedItem | null = null; // the item still accepting a line total and discounts
  let inOffers = false;
  const offerLabels: string[] = [];
  const offerAmounts: number[] = [];

  for (const row of rows) {
    const label = norm(row.label);
    const amount = row.amount === null ? null : parseAmountCents(row.amount);
    if (row.amount !== null && amount === null) notes.push(`unreadable amount "${row.amount}" next to "${label}"`);
    scanHeader(label, header);

    if (/DETALLE DE OFERTAS/i.test(label)) {
      inOffers = true; offerLabels.length = 0; offerAmounts.length = 0; current = null; candidate = null;
      continue;
    }
    if (inOffers) {
      if (/^TOT\.?\s*AHORRO/i.test(label)) { inOffers = false; footer.savingsCents = amount; continue; }
      if (label) offerLabels.push(label);
      if (amount !== null) offerAmounts.push(amount);
      continue;
    }
    if (/^SUBTOT/i.test(label)) { footer.subtotalCents = amount; current = null; candidate = null; continue; }
    if (/^DESCUENTOS POR PROMOCIONES/i.test(label)) { footer.discountsCents = amount; continue; }
    if (/^TOTAL\.?$/i.test(label)) { footer.totalCents = amount; continue; }
    const pay = PAYMENT_RE.exec(label);
    if (pay) { header.paymentMethod = pay[1].toUpperCase(); header.paymentRef = pay[2]; header.paymentCents = amount; continue; }

    const qty = QTY_RE.exec(label);
    if (qty) {
      const q = parseQtyMilli(qty[1]);
      const u = parseAmountCents(qty[2]);
      if (q === null || u === null) notes.push(`unreadable quantity line "${label}"`);
      else pending = { qtyMilli: q, unitPriceCents: u };
      current = null; candidate = null;
      continue;
    }

    const code = CODE_RE.exec(label);
    if (code) {
      if (!candidate) notes.push(`code line ${code[1]} has no description above it`);
      const desc = candidate ? norm(candidate.label) : "";
      const marker = /^[=\-−]/.test(desc);
      const descPrinted = marker ? "=" + desc.slice(1).trimStart() : desc;
      const fromCandidate = candidate?.amount == null ? null : parseAmountCents(candidate.amount);
      const qtyMilli = pending?.qtyMilli ?? 1000;
      current = {
        position: items.length + 1,
        descPrinted, noPromo: marker, sku: code[1], ean: code[2], qtyMilli,
        unit: qtyMilli % 1000 !== 0 || KG_RE.test(descPrinted) ? "kg" : "un",
        unitPriceCents: pending?.unitPriceCents ?? null,
        lineTotalCents: amount ?? fromCandidate,
        discounts: [],
      };
      items.push(current);
      pending = null; candidate = null;
      continue;
    }

    const tag = TAG_RE.exec(label);
    if (tag) {
      if (amount === null) { notes.push(`discount "${label}" has no amount`); continue; }
      const discount: DiscountLine = {
        label: norm(label.slice(0, tag.index)), tag: tag[1] as "M" | "A",
        amountCents: amount > 0 ? -amount : amount,
      };
      if (current) current.discounts.push(discount);
      else notes.push(`discount "${label}" has no item to attach to`);
      continue;
    }

    if (!label && amount !== null) {
      if (current && current.lineTotalCents === null) current.lineTotalCents = amount;
      else notes.push(`stray amount ${row.amount}`);
      continue;
    }

    if (label) candidate = row;
  }

  for (const it of items) {
    if (it.lineTotalCents === null) notes.push(`item ${it.position} (${it.descPrinted}) has no line total`);
  }
  footer.offers = offerLabels.map((l, i) => ({ label: l, amountCents: offerAmounts[i] ?? null }));
  if (offerLabels.length !== offerAmounts.length)
    notes.push(`offers: ${offerLabels.length} labels but ${offerAmounts.length} amounts`);
  return { header, items, footer, notes };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/parse.test.ts`
Expected: PASS (18 tests). If `mergePages` "keeps page 2's copy" fails, check `isTrailer`: the `PROMO [A]` row must be consumed into `end` so it is not appended twice.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipts/parse.ts src/lib/receipts/parse.test.ts src/lib/receipts/__fixtures__/rows.ts
git commit -m "feat(receipts): parse OCR rows into items, discounts and totals"
```

---

### Task 6: The verification gate

**Files:**
- Create: `web/src/lib/receipts/verify.ts`
- Test: `web/src/lib/receipts/verify.test.ts`

**Interfaces:**
- Consumes: `ParsedReceipt`, `parseRows` (Task 5); `parseRowsText` (Task 4); `fmtCents` (Task 1).
- Produces: `verify(parsed: ParsedReceipt): VerificationReport`; `Check`, `VerificationReport` as in the type table.

Spec §6 is the contract: three integer equalities are the gate; missing identity, missing items, missing line totals are errors; everything else is a warning.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/verify.test.ts
import { describe, it, expect } from "vitest";
import { verify } from "@/lib/receipts/verify";
import { parseRows } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

const run = (text: string) => verify(parseRows(parseRowsText(text)));

describe("verify", () => {
  it("passes the fixture with every check equal and no errors", () => {
    const r = run(SMALL_RECEIPT);
    expect(r.errors).toEqual([]);
    expect(r.checks).toEqual([
      { name: "subtotal", computed: 3559626, printed: 3559626, ok: true },
      { name: "discounts", computed: -847529, printed: -847529, ok: true },
      { name: "total", computed: 2712097, printed: 2712097, ok: true },
    ]);
    expect(r.ok).toBe(true);
  });

  it("cross-checks each printed offer against the matching discount lines", () => {
    const r = run(SMALL_RECEIPT);
    expect(r.offers).toEqual([
      { label: "1 *30% ELABORADOS", printed: 133639, computed: -133639, ok: true },
      { label: "1 *PESCADO 30%", printed: 135589, computed: -135589, ok: true },
      { label: "MERCADO PAGO 25% - V", printed: 578301, computed: -578301, ok: true },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("fails when a line total is misread, naming the check that broke", () => {
    const r = run(SMALL_RECEIPT.replace("6400,00", "6490,00"));
    expect(r.ok).toBe(false);
    expect(r.checks.map(c => [c.name, c.ok])).toEqual([["subtotal", false], ["discounts", true], ["total", false]]);
    expect(r.checks[0].computed - r.checks[0].printed!).toBe(9000);
  });

  it("fails when a discount is dropped", () => {
    const r = run(SMALL_RECEIPT.replace("MERCADO PAGO 25% - V [M]\t-793,00\n", ""));
    expect(r.checks.find(c => c.name === "discounts")?.ok).toBe(false);
  });

  it("errors on a missing ticket number, date, items or line total", () => {
    expect(run("TOTAL\t1,00\n").errors).toEqual(expect.arrayContaining([
      expect.stringContaining("date"), expect.stringContaining("NRO.T."), expect.stringContaining("no items"),
    ]));
    const noTotal = run(SMALL_RECEIPT.replace("0000014718 07798140550143\t6400,00", "0000014718 07798140550143"));
    expect(noTotal.ok).toBe(false);
    expect(noTotal.errors.join(" ")).toContain("item 3");
  });

  it("errors when a printed total is missing rather than comparing against nothing", () => {
    const r = run(SMALL_RECEIPT.replace("TOTAL\t27120,97\n", ""));
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.name === "total")).toMatchObject({ printed: null, ok: false });
  });

  it("warns, but passes, when a unit price does not multiply out to the line total", () => {
    const r = run(SMALL_RECEIPT.replace("0,172 x 25899,00", "0,172 x 25099,00"));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/item 1 .*unit price/);
  });

  it("warns, but passes, when an offer total does not match its lines", () => {
    const r = run(SMALL_RECEIPT.replace("MERCADO PAGO 25% - V\t1355,89\n\t5783,01", "MERCADO PAGO 25% - V\t1355,89\n\t5783,02"));
    expect(r.ok).toBe(true);
    expect(r.offers[2].ok).toBe(false);
    expect(r.warnings.join(" ")).toContain("MERCADO PAGO 25% - V");
  });

  it("warns when TOT.AHORRO disagrees with the discounts", () => {
    const r = run(SMALL_RECEIPT.replace("TOT.AHORRO\t8475,29", "TOT.AHORRO\t8475,20"));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("TOT.AHORRO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/verify.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/verify`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/receipts/verify.ts
import { fmtCents } from "./money";
import type { ParsedReceipt } from "./parse";

export type Check = {
  name: "subtotal" | "discounts" | "total";
  computed: number;
  printed: number | null;
  ok: boolean;
};
export type OfferCheck = { label: string; printed: number | null; computed: number | null; ok: boolean };
export type VerificationReport = {
  ok: boolean;
  checks: Check[];
  offers: OfferCheck[];
  warnings: string[];
  errors: string[];
};

function check(name: Check["name"], computed: number, printed: number | null): Check {
  return { name, computed, printed, ok: printed !== null && printed === computed };
}

function offerKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * The gate. Integers only: the sum of the line totals must be the printed subtotal, the sum of
 * every discount line the printed discounts, and their sum the printed total — to the cent. A
 * receipt that fails any of them is not admitted. Everything else here is advice for the
 * reader: a unit price that does not multiply out (analytics derive unit prices from the line
 * total anyway), an offer whose printed total does not match its lines, TOT.AHORRO drifting.
 */
export function verify(p: ParsedReceipt): VerificationReport {
  const errors: string[] = [];
  const warnings: string[] = [...p.notes.filter(n => !n.includes("has no line total"))];

  if (!p.header.date) errors.push("date not read from the header");
  if (!p.header.fiscalNumber) errors.push("ticket number (NRO.T.) not read from the header");
  if (p.items.length === 0) errors.push("no items read");
  for (const it of p.items) {
    if (it.lineTotalCents === null) errors.push(`item ${it.position} (${it.descPrinted}) has no line total`);
  }

  const subtotal = p.items.reduce((s, it) => s + (it.lineTotalCents ?? 0), 0);
  const discounts = p.items.reduce((s, it) => s + it.discounts.reduce((d, x) => d + x.amountCents, 0), 0);
  const total = subtotal + discounts;
  const checks: Check[] = [
    check("subtotal", subtotal, p.footer.subtotalCents),
    check("discounts", discounts, p.footer.discountsCents),
    check("total", total, p.footer.totalCents),
  ];
  for (const c of checks) {
    if (c.printed === null) errors.push(`printed ${c.name} not read`);
  }

  if (p.footer.savingsCents !== null && p.footer.savingsCents !== -discounts)
    warnings.push(`TOT.AHORRO reads ${fmtCents(p.footer.savingsCents)} but the discount lines sum to ${fmtCents(-discounts)}`);

  for (const it of p.items) {
    if (it.unitPriceCents === null || it.lineTotalCents === null) continue;
    const expected = Math.round(it.qtyMilli * it.unitPriceCents / 1000);
    if (Math.abs(expected - it.lineTotalCents) > 1)
      warnings.push(`item ${it.position} (${it.descPrinted}): ${it.qtyMilli / 1000} × ${fmtCents(it.unitPriceCents)} = ${fmtCents(expected)} but the line total is ${fmtCents(it.lineTotalCents)}; the unit price is probably misread`);
  }

  const byLabel = new Map<string, number>();
  for (const it of p.items) {
    for (const d of it.discounts) byLabel.set(offerKey(d.label), (byLabel.get(offerKey(d.label)) ?? 0) + d.amountCents);
  }
  const offers = p.footer.offers.map(o => {
    const computed = byLabel.get(offerKey(o.label)) ?? null;
    const ok = o.amountCents !== null && computed !== null && computed === -o.amountCents;
    if (!ok)
      warnings.push(`offer "${o.label}": printed ${o.amountCents === null ? "nothing" : fmtCents(o.amountCents)}, item lines give ${computed === null ? "no match" : fmtCents(-computed)}`);
    return { label: o.label, printed: o.amountCents, computed, ok };
  });

  return { ok: errors.length === 0 && checks.every(c => c.ok), checks, offers, warnings, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/verify.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/verify.ts src/lib/receipts/verify.test.ts
git commit -m "feat(receipts): exact-cent verification gate with a readable report"
```

---

### Task 7: Schema, storage and the ingest orchestration

**Files:**
- Modify: `web/src/lib/db.ts` (inside `migrate()`, after the `merchant_aliases` table)
- Modify: `web/src/lib/db.test.ts`
- Create: `web/src/lib/receipts/ingest.ts`
- Test: `web/src/lib/receipts/ingest.test.ts`

**Interfaces:**
- Consumes: `renderPages`/`PageImage` (Task 2), `ocrPages`/`Box` (Task 3), `boxesToRows`/`serializeRows`/`parseRowsText` (Task 4), `parseRows` (Task 5), `verify` (Task 6), `Failure`, `REPO_ROOT` from `@/lib/upload`.
- Produces: `ingestReceipt(db, bytes, deps?): Promise<ReceiptStored>`, `ingestCorrected(db, sha256, rowsText, deps?): Promise<ReceiptStored>`, `storeReceipt(db, input): ReceiptStored`, `class ReceiptRejected extends Error { payload: ReceiptFailure }`, `receiptDir(): string`, `sha256(bytes): string`, `MAX_RECEIPT_BYTES`, `OCR_SCALES`, `type ReceiptDeps = { renderPages, ocr }`.

- [ ] **Step 1: Add the tables**

In `web/src/lib/db.ts`, append inside the `db.exec(\`...\`)` string, after `merchant_aliases`:

```sql
    -- Supermarket receipts (spec: docs/superpowers/specs/2026-09-04-supermarket-receipts.md).
    -- Money is integer cents and quantities integer thousandths: the ingest gate reconciles a
    -- receipt to the cent, and a REAL that lands 0.004 off would fail one that is right on paper.
    -- fiscal_number (NRO.T.) and the file hash are the two identities; the file NAME is nothing.
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY,
      chain TEXT NOT NULL,
      branch_code TEXT,
      branch_name TEXT,
      date TEXT NOT NULL,
      time TEXT,
      fiscal_number TEXT NOT NULL UNIQUE,
      file_sha256 TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      register TEXT,
      terminal TEXT,
      trx TEXT,
      cae TEXT,
      cae_due TEXT,
      payment_method TEXT,
      payment_ref TEXT,
      subtotal_cents INTEGER NOT NULL,
      discounts_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      header_json TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      transcript_source TEXT NOT NULL CHECK (transcript_source IN ('ocr','corrected')),
      ocr_scale REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY,
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      desc_printed TEXT NOT NULL,
      no_promo INTEGER NOT NULL DEFAULT 0,
      sku TEXT,
      ean TEXT,
      qty_milli INTEGER NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('un','kg')),
      unit_price_cents INTEGER,
      line_total_cents INTEGER NOT NULL,
      UNIQUE (receipt_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
    CREATE TABLE IF NOT EXISTS receipt_discounts (
      id INTEGER PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      tag TEXT NOT NULL CHECK (tag IN ('M','A')),
      amount_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipt_transcripts (
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ocr','corrected')),
      text TEXT NOT NULL,
      PRIMARY KEY (receipt_id, kind)
    );
```

- [ ] **Step 2: Write the failing schema test**

Append to `web/src/lib/db.test.ts` inside `describe("db", ...)`:

```ts
  it("stores a receipt with its items and discounts, and cascades on delete", () => {
    const db = openDb(":memory:");
    const r = db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', '2090-06514979', 'abc', '/x/abc.pdf', 14693191, -3720357, 10972834, '{}', '{}', 'ocr', 3, '2026-09-04T12:00:00Z')`
    ).run();
    const item = db.prepare(
      `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, ean, qty_milli, unit, unit_price_cents, line_total_cents)
       VALUES (?, 1, 'VERDURAS GRILLADAS COTOX KG', '0000038072', '02538072001727', 172, 'kg', 2589900, 445463)`
    ).run(r.lastInsertRowid);
    db.prepare(`INSERT INTO receipt_discounts (item_id, position, label, tag, amount_cents) VALUES (?, 1, '1 *30% ELABORADOS', 'A', -133639)`)
      .run(item.lastInsertRowid);
    db.prepare(`INSERT INTO receipt_transcripts (receipt_id, kind, text) VALUES (?, 'ocr', 'TOTAL\t1,00')`).run(r.lastInsertRowid);
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_discounts").get()).toEqual({ n: 1 });
    db.prepare("DELETE FROM receipts").run();
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_items").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_discounts").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_transcripts").get()).toEqual({ n: 0 });
  });

  it("refuses a second receipt with the same ticket number or the same file hash", () => {
    const db = openDb(":memory:");
    const ins = (fiscal: string, sha: string) => db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, sha);
    ins("2090-1", "sha-1");
    expect(() => ins("2090-1", "sha-2")).toThrow();
    expect(() => ins("2090-2", "sha-1")).toThrow();
    expect(() => db.prepare(`INSERT INTO receipt_items (receipt_id, position, desc_printed, qty_milli, unit, line_total_cents) VALUES (1, 1, 'x', 1000, 'lb', 1)`).run()).toThrow();
  });
```

Run: `npx vitest run src/lib/db.test.ts` — expected FAIL (`no such table: receipts`) before Step 1 is in, PASS after. Then commit the schema on its own:

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(db): receipt tables — integer cents, cascade, two identities"
```

- [ ] **Step 3: Write the failing ingest test**

```ts
// web/src/lib/receipts/ingest.test.ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/ingest.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/ingest`.

- [ ] **Step 5: Write the implementation**

```ts
// web/src/lib/receipts/ingest.ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/ingest.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/receipts/ingest.ts src/lib/receipts/ingest.test.ts
git commit -m "feat(receipts): ingest orchestration — scales, gate, dedup, pending corrections"
```

---

### Task 8: Queries for the pages

**Files:**
- Create: `web/src/lib/receipts/queries.ts`
- Test: `web/src/lib/receipts/queries.test.ts`

**Interfaces:**
- Consumes: the tables of Task 7; `storeReceipt`/`ingestReceipt` (Task 7) to seed test data; `VerificationReport` (Task 6).
- Produces: `receiptList(db): ReceiptSummary[]`, `receiptDetail(db, id): ReceiptDetail | null` with the row types below.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/receipts/queries.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/receipts/queries.test.ts`
Expected: FAIL — cannot resolve `@/lib/receipts/queries`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/receipts/queries.ts
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
    header: JSON.parse(header_json) as ReceiptHeaderExtras,
    items: items.map(it => ({ ...it, discounts: byItem.get(it.id) ?? [] })),
    report: JSON.parse(verification_json) as VerificationReport,
    transcript: transcript?.text ?? "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/receipts/queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/queries.ts src/lib/receipts/queries.test.ts
git commit -m "feat(receipts): list and detail queries"
```

---

### Task 9: Route handlers

**Files:**
- Create: `web/src/app/api/receipts/route.ts`
- Create: `web/src/app/api/receipts/corrected/route.ts`
- Modify: `web/src/lib/i18n.ts` (one key used by both handlers)

**Interfaces:**
- Consumes: `ingestReceipt`, `ingestCorrected`, `ReceiptRejected` (Task 7); `Failure`; `getLocale`, `translate`.
- Produces: `POST /api/receipts` (multipart `file`) → `200 ReceiptStored` | `422 { code: "verification_failed", message, report, rowsText, sha256, scale }` | `400 { code, message, hint? }` | `500`. `POST /api/receipts/corrected` (JSON `{ sha256, rowsText }`) → same shapes.

Route handlers have no unit tests in this codebase (the existing `api/upload/route.ts` has none either); their logic is three lines of mapping over the tested library. They are verified in the browser in Task 10.

- [ ] **Step 1: Add the rejection message key**

In `web/src/lib/i18n.ts`, `en`:

```ts
  "receipts.rejected": "The receipt did not reconcile, so nothing was stored. Fix the text below and verify again.",
```

`es`:

```ts
  "receipts.rejected": "El ticket no cierra, así que no se guardó nada. Corregí el texto de abajo y verificá de nuevo.",
```

- [ ] **Step 2: Write the upload handler**

```ts
// web/src/app/api/receipts/route.ts
import { getDb } from "@/lib/db";
import { ingestReceipt, ReceiptRejected } from "@/lib/receipts/ingest";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const locale = await getLocale();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File))
    return Response.json({ code: "bad_name", message: translate(locale, "failure.noFile") }, { status: 400 });
  try {
    // file.name is deliberately not passed: nothing about a receipt is in its file name.
    return Response.json(await ingestReceipt(getDb(), Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof ReceiptRejected)
      return Response.json(
        { code: "verification_failed", message: translate(locale, "receipts.rejected"), ...e.payload }, { status: 422 },
      );
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write the correction handler**

```ts
// web/src/app/api/receipts/corrected/route.ts
import { getDb } from "@/lib/db";
import { ingestCorrected, ReceiptRejected } from "@/lib/receipts/ingest";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const locale = await getLocale();
  let body: { sha256?: unknown; rowsText?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ code: "bad_rows", message: translate(locale, "failure.bad_rows") }, { status: 400 });
  }
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : "";
  const rowsText = typeof body.rowsText === "string" ? body.rowsText : "";
  try {
    return Response.json(await ingestCorrected(getDb(), sha256, rowsText));
  } catch (e) {
    if (e instanceof ReceiptRejected)
      return Response.json(
        { code: "verification_failed", message: translate(locale, "receipts.rejected"), ...e.payload }, { status: 422 },
      );
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    return Response.json({ code: "ingest_failed", message: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit` — expected: no errors. Run: `npx vitest run src/lib/i18n.test.ts` — PASS.

```bash
git add src/app/api/receipts/route.ts src/app/api/receipts/corrected/route.ts src/lib/i18n.ts
git commit -m "feat(receipts): upload and correction route handlers"
```

---

### Task 10: Pages, drop zone, navigation

**Files:**
- Create: `web/src/components/ReceiptReport.tsx`
- Create: `web/src/components/ReceiptDrop.tsx`
- Create: `web/src/app/receipts/page.tsx`
- Create: `web/src/app/receipts/[id]/page.tsx`
- Modify: `web/src/components/Nav.tsx` (GROUPS), `web/src/lib/chrome.ts` (CHROME), `web/src/lib/i18n.ts` (both dictionaries)
- Test: existing `web/src/lib/chrome.test.ts` and `web/src/lib/i18n.test.ts` gate this task; plus a browser check.

**Interfaces:**
- Consumes: `receiptList`, `receiptDetail` (Task 8); `fmtArsCents`, `fmtCents` (Task 1); `VerificationReport` (Task 6); the two routes (Task 9); `getDb`, `getT`, `useT`, `Stat` (existing).
- Produces: routes `/receipts` and `/receipts/[id]`; nav group "Supermarket".

- [ ] **Step 1: Dictionary keys**

Add to `en` in `web/src/lib/i18n.ts` (put the `nav.*` ones beside the other nav keys, the rest in a new `// ── receipts ──` block):

```ts
  "nav.group.supermarket": "Supermarket",
  "nav.receipts": "Receipts",

  "receipts.title": "Supermarket receipts",
  "receipts.detail.title": "Receipt",
  "receipts.drop.idle": "Drop a Coto receipt PDF here, or click to choose one",
  "receipts.drop.busy": "Reading the receipt…",
  "receipts.stored": "Receipt of {date} stored: {items} items, total {total}.",
  "receipts.open": "Open",
  "receipts.reverify": "Verify again",
  "receipts.textareaHint": "One printed line per row; the amount goes after a tab or two spaces. Fix the digits that are wrong, then verify again.",
  "receipts.error.unreadable": "The server did not answer with a readable result.",
  "receipts.check": "Check",
  "receipts.computed": "From the lines",
  "receipts.printed": "Printed",
  "receipts.check.subtotal": "Subtotal before discounts",
  "receipts.check.discounts": "Promotion discounts",
  "receipts.check.total": "Total",
  "receipts.errors": "Errors",
  "receipts.warnings": "Warnings",
  "receipts.offers": "Offers applied",
  "receipts.offers.label": "Offer",
  "receipts.offers.computed": "From the item lines",
  "receipts.table.date": "Date",
  "receipts.table.time": "Time",
  "receipts.table.branch": "Branch",
  "receipts.table.items": "Items",
  "receipts.table.subtotal": "Subtotal",
  "receipts.table.discounts": "Discounts",
  "receipts.table.total": "Total",
  "receipts.table.savings": "Saved",
  "receipts.table.source": "Source",
  "receipts.source.ocr": "OCR",
  "receipts.source.corrected": "corrected by hand",
  "receipts.empty": "No receipts yet. Drop the first one above.",
  "receipts.note": "The PDF is read on this machine with Apple Vision; nothing leaves it. A receipt is stored only when the line totals, the discounts and the total add up exactly to what is printed. The same ticket, or the same file, is never stored twice.",
  "receipts.footer": "This page receives the supermarket receipts. Drop the PDF of one receipt. The reader turns the scan into lines and checks the sums against the totals printed on the receipt. If the sums match, the receipt is stored and appears in the table. If they do not, nothing is stored: the page shows which sum is off and the text it read, so you can fix a digit and check again. Each row in the table is one receipt; open it to see every item, its discounts and the checks.",
  "receipts.detail.facts": "Receipt",
  "receipts.detail.fiscal": "Ticket number",
  "receipts.detail.register": "Register",
  "receipts.detail.terminal": "Terminal",
  "receipts.detail.trx": "Transaction",
  "receipts.detail.payment": "Payment",
  "receipts.detail.cae": "CAE",
  "receipts.detail.file": "File",
  "receipts.detail.scale": "OCR scale",
  "receipts.detail.verification": "Verification",
  "receipts.detail.items": "Items",
  "receipts.detail.transcript": "Transcript",
  "receipts.items.desc": "Description",
  "receipts.items.code": "Code / EAN",
  "receipts.items.qty": "Qty",
  "receipts.items.unitPrice": "Unit price",
  "receipts.items.lineTotal": "Line total",
  "receipts.items.discounts": "Discounts",
  "receipts.items.net": "Net",
  "receipts.stat.total": "Total paid",
  "receipts.stat.saved": "Saved",
  "receipts.stat.items": "Items",
  "receipts.stat.ofGross": "{pct} of the gross",
  "receipts.detail.footer": "This page shows one receipt as it was read. The three checks at the top compare what the lines add up to with what the receipt prints; all three must be equal for the receipt to be here at all. Warnings do not block anything: they point at a unit price or an offer total that reads oddly. The items table lists every line in printed order with its code, quantity, price and discounts. The transcript at the bottom is the text the reader produced, or the text you corrected.",
```

And the same keys in `es`:

```ts
  "nav.group.supermarket": "Súper",
  "nav.receipts": "Tickets",

  "receipts.title": "Tickets del súper",
  "receipts.detail.title": "Ticket",
  "receipts.drop.idle": "Soltá acá el PDF de un ticket de Coto, o hacé clic para elegirlo",
  "receipts.drop.busy": "Leyendo el ticket…",
  "receipts.stored": "Ticket del {date} guardado: {items} artículos, total {total}.",
  "receipts.open": "Abrir",
  "receipts.reverify": "Verificar de nuevo",
  "receipts.textareaHint": "Una línea impresa por renglón; el importe va después de un tab o de dos espacios. Corregí los dígitos que estén mal y verificá de nuevo.",
  "receipts.error.unreadable": "El servidor no respondió con un resultado legible.",
  "receipts.check": "Control",
  "receipts.computed": "Según las líneas",
  "receipts.printed": "Impreso",
  "receipts.check.subtotal": "Subtotal sin descuentos",
  "receipts.check.discounts": "Descuentos por promociones",
  "receipts.check.total": "Total",
  "receipts.errors": "Errores",
  "receipts.warnings": "Advertencias",
  "receipts.offers": "Ofertas aplicadas",
  "receipts.offers.label": "Oferta",
  "receipts.offers.computed": "Según las líneas de artículos",
  "receipts.table.date": "Fecha",
  "receipts.table.time": "Hora",
  "receipts.table.branch": "Sucursal",
  "receipts.table.items": "Artículos",
  "receipts.table.subtotal": "Subtotal",
  "receipts.table.discounts": "Descuentos",
  "receipts.table.total": "Total",
  "receipts.table.savings": "Ahorro",
  "receipts.table.source": "Origen",
  "receipts.source.ocr": "OCR",
  "receipts.source.corrected": "corregido a mano",
  "receipts.empty": "Todavía no hay tickets. Soltá el primero arriba.",
  "receipts.note": "El PDF se lee en esta máquina con Apple Vision; nada sale de acá. Un ticket se guarda solo cuando los importes de las líneas, los descuentos y el total suman exactamente lo impreso. El mismo ticket, o el mismo archivo, nunca se guarda dos veces.",
  "receipts.footer": "Esta página recibe los tickets del súper. Soltá el PDF de un ticket. El lector convierte el escaneo en líneas y compara las sumas con los totales impresos en el ticket. Si las sumas coinciden, el ticket se guarda y aparece en la tabla. Si no, no se guarda nada: la página muestra qué suma no cierra y el texto que leyó, para que corrijas un dígito y vuelvas a controlar. Cada fila de la tabla es un ticket; abrilo para ver cada artículo, sus descuentos y los controles.",
  "receipts.detail.facts": "Ticket",
  "receipts.detail.fiscal": "Número de ticket",
  "receipts.detail.register": "Caja",
  "receipts.detail.terminal": "Terminal",
  "receipts.detail.trx": "Transacción",
  "receipts.detail.payment": "Pago",
  "receipts.detail.cae": "CAE",
  "receipts.detail.file": "Archivo",
  "receipts.detail.scale": "Escala de OCR",
  "receipts.detail.verification": "Verificación",
  "receipts.detail.items": "Artículos",
  "receipts.detail.transcript": "Transcripción",
  "receipts.items.desc": "Descripción",
  "receipts.items.code": "Código / EAN",
  "receipts.items.qty": "Cant.",
  "receipts.items.unitPrice": "Precio unit.",
  "receipts.items.lineTotal": "Importe",
  "receipts.items.discounts": "Descuentos",
  "receipts.items.net": "Neto",
  "receipts.stat.total": "Total pagado",
  "receipts.stat.saved": "Ahorro",
  "receipts.stat.items": "Artículos",
  "receipts.stat.ofGross": "{pct} del bruto",
  "receipts.detail.footer": "Esta página muestra un ticket tal como se leyó. Los tres controles de arriba comparan lo que suman las líneas con lo que imprime el ticket; los tres tienen que ser iguales para que el ticket esté acá. Las advertencias no bloquean nada: señalan un precio unitario o un total de oferta que se lee raro. La tabla de artículos lista cada línea en el orden impreso con su código, cantidad, precio y descuentos. La transcripción del final es el texto que produjo el lector, o el que corregiste.",
```

Run `npx vitest run src/lib/i18n.test.ts` — PASS.

- [ ] **Step 2: Nav and chrome**

In `web/src/components/Nav.tsx`, insert before the `nav.group.data` group:

```ts
  {
    heading: "nav.group.supermarket",
    links: [["/receipts", "nav.receipts"]],
  },
```

In `web/src/lib/chrome.ts`, add to `CHROME` (alphabetical position, after `/recurring`):

```ts
  "/receipts": { title: "receipts.title" },
  // The dynamic segment is the route as chrome.test derives it from the directory name.
  "/receipts/[id]": { title: "receipts.detail.title" },
```

- [ ] **Step 3: The report component (shared by drop zone and detail page)**

```tsx
// web/src/components/ReceiptReport.tsx
import type { MessageKey, Vars } from "@/lib/i18n";
import type { VerificationReport } from "@/lib/receipts/verify";
import { fmtCents } from "@/lib/receipts/money";

type T = (key: MessageKey, vars?: Vars) => string;

const CHECK_KEY: Record<VerificationReport["checks"][number]["name"], MessageKey> = {
  subtotal: "receipts.check.subtotal",
  discounts: "receipts.check.discounts",
  total: "receipts.check.total",
};

/**
 * The reconciliation report, the same markup wherever it appears. No hooks so it renders on the
 * server (detail page) and inside the client drop zone alike; the translator comes in as a prop.
 */
export function ReceiptReport({ report, t }: { report: VerificationReport; t: T }) {
  return (
    <div className="space-y-3 text-sm">
      <table className="w-full">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{t("receipts.check")}</th>
          <th className="text-right">{t("receipts.computed")}</th>
          <th className="text-right">{t("receipts.printed")}</th>
          <th className="w-8"></th>
        </tr></thead>
        <tbody>
          {report.checks.map(c => (
            <tr key={c.name} className="border-t border-line">
              <td className="py-1">{t(CHECK_KEY[c.name])}</td>
              <td className="text-right font-mono">{fmtCents(c.computed)}</td>
              <td className="text-right font-mono">{c.printed === null ? "—" : fmtCents(c.printed)}</td>
              <td className={`text-center ${c.ok ? "text-positive" : "text-negative"}`}>{c.ok ? "✓" : "✗"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.errors.length > 0 && (
        <div>
          <div className="font-medium text-negative">{t("receipts.errors")}</div>
          <ul className="list-disc pl-5">{report.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {report.offers.length > 0 && (
        <table className="w-full">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">{t("receipts.offers.label")}</th>
            <th className="text-right">{t("receipts.printed")}</th>
            <th className="text-right">{t("receipts.offers.computed")}</th>
            <th className="w-8"></th>
          </tr></thead>
          <tbody>
            {report.offers.map((o, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{o.label}</td>
                <td className="text-right font-mono">{o.printed === null ? "—" : fmtCents(o.printed)}</td>
                <td className="text-right font-mono">{o.computed === null ? "—" : fmtCents(-o.computed)}</td>
                <td className={`text-center ${o.ok ? "text-positive" : "text-warning"}`}>{o.ok ? "✓" : "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.warnings.length > 0 && (
        <div>
          <div className="font-medium text-warning">{t("receipts.warnings")}</div>
          <ul className="list-disc pl-5 text-ink-muted">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```

`text-positive`, `text-negative`, `text-warning` exist in `globals.css` (`@theme inline`); check with `grep -n "positive\|negative\|warning" src/app/globals.css` and use the names found there if they differ.

- [ ] **Step 4: The drop zone**

```tsx
// web/src/components/ReceiptDrop.tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./I18nProvider";
import { ReceiptReport } from "./ReceiptReport";
import { fmtArsCents } from "@/lib/receipts/money";
import type { VerificationReport } from "@/lib/receipts/verify";

type Stored = { id: number; date: string; totalCents: number; items: number; report: VerificationReport };
type Rejected = { message: string; report: VerificationReport; rowsText: string; sha256: string; scale: number };
type ApiError = { code: string; message: string; hint?: string };
type Outcome =
  | { kind: "stored"; stored: Stored }
  | { kind: "rejected"; rejected: Rejected }
  | { kind: "error"; error: ApiError }
  | null;

export function ReceiptDrop() {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [rowsText, setRowsText] = useState("");

  async function settle(request: Promise<Response>) {
    setBusy(true);
    try {
      const res = await request;
      const json = await res.json();
      if (res.ok) setOutcome({ kind: "stored", stored: json as Stored });
      else if (res.status === 422) {
        setOutcome({ kind: "rejected", rejected: json as Rejected });
        setRowsText((json as Rejected).rowsText);
      } else setOutcome({ kind: "error", error: json as ApiError });
      router.refresh();
    } catch {
      // A network drop or a non-JSON body must still clear `busy`.
      setOutcome({ kind: "error", error: { code: "unknown", message: t("receipts.error.unreadable") } });
    } finally {
      setBusy(false);
    }
  }

  function send(file: File | undefined) {
    if (!file) return;
    setOutcome(null);
    const body = new FormData();
    body.append("file", file);
    void settle(fetch("/api/receipts", { method: "POST", body }));
  }

  function reverify(sha256: string) {
    void settle(fetch("/api/receipts/corrected", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256, rowsText }),
    }));
  }

  return (
    <div className="mb-6">
      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]); }}
        className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors focus-within:border-accent focus-within:text-accent ${
          over ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-muted hover:border-accent hover:text-ink"
        }`}
      >
        <input type="file" accept="application/pdf" className="sr-only" disabled={busy}
          onChange={e => { send(e.target.files?.[0]); e.target.value = ""; }} />
        {busy ? t("receipts.drop.busy") : t("receipts.drop.idle")}
      </label>

      {outcome?.kind === "error" && (
        <div className="mt-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{outcome.error.message}</p>
          {outcome.error.hint && <p className="mt-1 text-ink-muted">{outcome.error.hint}</p>}
        </div>
      )}

      {outcome?.kind === "stored" && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p>
            {t("receipts.stored", {
              date: outcome.stored.date, items: outcome.stored.items, total: fmtArsCents(outcome.stored.totalCents),
            })}{" "}
            <Link href={`/receipts/${outcome.stored.id}`} className="text-accent underline">{t("receipts.open")}</Link>
          </p>
          {outcome.stored.report.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-ink-muted">
              {outcome.stored.report.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {outcome?.kind === "rejected" && (
        <div className="mt-3 space-y-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{outcome.rejected.message}</p>
          <ReceiptReport report={outcome.rejected.report} t={t} />
          <p className="text-xs text-ink-muted">{t("receipts.textareaHint")}</p>
          <textarea
            value={rowsText}
            onChange={e => setRowsText(e.target.value)}
            spellCheck={false}
            className="h-96 w-full rounded-md border border-line bg-canvas p-2 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => reverify(outcome.rejected.sha256)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("receipts.drop.busy") : t("receipts.reverify")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: The list page**

```tsx
// web/src/app/receipts/page.tsx
import Link from "next/link";
import { getDb } from "@/lib/db";
import { receiptList } from "@/lib/receipts/queries";
import { fmtArsCents } from "@/lib/receipts/money";
import { ReceiptDrop } from "@/components/ReceiptDrop";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

function savedPct(discounts: number, subtotal: number): string {
  if (subtotal === 0) return "—";
  return `${(-discounts * 100 / subtotal).toFixed(1).replace(".", ",")}%`;
}

export default async function Receipts() {
  const rows = receiptList(getDb());
  const tr = await getT();
  return (
    <main>
      <ReceiptDrop />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{tr("receipts.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">{tr("receipts.table.date")}</th><th>{tr("receipts.table.time")}</th>
            <th>{tr("receipts.table.branch")}</th>
            <th className="text-right">{tr("receipts.table.items")}</th>
            <th className="text-right">{tr("receipts.table.subtotal")}</th>
            <th className="text-right">{tr("receipts.table.discounts")}</th>
            <th className="text-right">{tr("receipts.table.total")}</th>
            <th className="text-right">{tr("receipts.table.savings")}</th>
            <th>{tr("receipts.table.source")}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1"><Link href={`/receipts/${r.id}`} className="text-accent underline">{r.date}</Link></td>
                <td>{r.time ?? "—"}</td>
                <td>{r.branch_name ?? "—"}</td>
                <td className="text-right">{r.items}</td>
                <td className="text-right font-mono">{fmtArsCents(r.subtotal_cents)}</td>
                <td className="text-right font-mono">{fmtArsCents(r.discounts_cents)}</td>
                <td className="text-right font-mono">{fmtArsCents(r.total_cents)}</td>
                <td className="text-right">{savedPct(r.discounts_cents, r.subtotal_cents)}</td>
                <td className="text-ink-muted">{tr(r.transcript_source === "ocr" ? "receipts.source.ocr" : "receipts.source.corrected")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("receipts.note")}</p>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("receipts.footer")}</p>
    </main>
  );
}
```

- [ ] **Step 6: The detail page**

```tsx
// web/src/app/receipts/[id]/page.tsx
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { receiptDetail } from "@/lib/receipts/queries";
import { fmtArsCents, fmtCents } from "@/lib/receipts/money";
import { ReceiptReport } from "@/components/ReceiptReport";
import { Stat } from "@/components/Stat";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

function qty(milli: number, unit: "un" | "kg"): string {
  return unit === "kg" ? `${(milli / 1000).toFixed(3).replace(".", ",")} kg` : `${milli / 1000}`;
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) notFound();
  const d = receiptDetail(getDb(), n);
  if (!d) notFound();
  const tr = await getT();
  const { receipt, items, report, header, transcript } = d;
  const saved = receipt.subtotal_cents === 0 ? 0 : -receipt.discounts_cents * 100 / receipt.subtotal_cents;

  return (
    <main className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={tr("receipts.stat.total")} value={fmtArsCents(receipt.total_cents)} detail={`${receipt.date} ${receipt.time ?? ""}`} />
        <Stat label={tr("receipts.stat.saved")} value={fmtArsCents(-receipt.discounts_cents)}
          detail={tr("receipts.stat.ofGross", { pct: `${saved.toFixed(1).replace(".", ",")}%` })} />
        <Stat label={tr("receipts.stat.items")} value={items.length} detail={receipt.branch_name ?? ""} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.facts")}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">{tr("receipts.detail.fiscal")}</dt><dd className="font-mono">{receipt.fiscal_number}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.register")}</dt><dd>{receipt.register ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.terminal")}</dt><dd>{receipt.terminal ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.trx")}</dt><dd>{receipt.trx ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.payment")}</dt>
          <dd>{receipt.payment_method ? `${receipt.payment_method} ${receipt.payment_ref ?? ""}` : "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.cae")}</dt>
          <dd className="font-mono">{receipt.cae ? `${receipt.cae} (${receipt.cae_due ?? "—"})` : "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.file")}</dt><dd className="font-mono text-xs">{receipt.file_sha256}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.scale")}</dt>
          <dd>{receipt.transcript_source === "corrected" ? tr("receipts.source.corrected") : `${receipt.ocr_scale}×`}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.verification")}</h2>
        <ReceiptReport report={report} t={tr} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.items")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted">
              <th className="py-1">#</th><th>{tr("receipts.items.desc")}</th><th>{tr("receipts.items.code")}</th>
              <th className="text-right">{tr("receipts.items.qty")}</th>
              <th className="text-right">{tr("receipts.items.unitPrice")}</th>
              <th className="text-right">{tr("receipts.items.lineTotal")}</th>
              <th>{tr("receipts.items.discounts")}</th>
              <th className="text-right">{tr("receipts.items.net")}</th>
            </tr></thead>
            <tbody>
              {items.map(it => {
                const discount = it.discounts.reduce((s, x) => s + x.amount_cents, 0);
                return (
                  <tr key={it.id} className="border-t border-line align-top">
                    <td className="py-1 text-ink-muted">{it.position}</td>
                    <td>{it.desc_printed}</td>
                    <td className="font-mono text-xs text-ink-muted">{it.sku ?? "—"}<br />{it.ean ?? ""}</td>
                    <td className="text-right">{qty(it.qty_milli, it.unit)}</td>
                    <td className="text-right font-mono">{it.unit_price_cents === null ? "—" : fmtCents(it.unit_price_cents)}</td>
                    <td className="text-right font-mono">{fmtCents(it.line_total_cents)}</td>
                    <td className="text-xs">
                      {it.discounts.map(x => (
                        <div key={x.id}><span className="text-ink-muted">[{x.tag}]</span> {x.label} <span className="font-mono">{fmtCents(x.amount_cents)}</span></div>
                      ))}
                    </td>
                    <td className="text-right font-mono">{fmtCents(it.line_total_cents + discount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {header.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-ink-muted">{header.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-semibold">{tr("receipts.detail.transcript")}</summary>
        <pre className="mt-2 max-h-[40rem] overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-xs">{transcript}</pre>
      </details>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("receipts.detail.footer")}</p>
    </main>
  );
}
```

- [ ] **Step 7: Run the gates**

Run: `npx vitest run` — all green, including `chrome.test.ts` (two new routes, both in `CHROME`, no `<h1>` in either page) and `i18n.test.ts`. Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 8: Verify in the browser**

Start the dev server (`.claude/launch.json`, name `tarjetas`, port 3000 — it is normally already running; `nvm use` first if starting it). Open `http://localhost:3000/receipts`:
1. "Supermarket" group appears in the sidebar with "Receipts"; the page title reads "Supermarket receipts"; the empty state shows.
2. Drop `~/Desktop/Super/coto_04_09_2026.pdf`. Within ~30 s the stored panel appears: "Receipt of 2026-09-04 stored: 21 items, total $ 109.728,34." The table gets one row. Console and server logs show no errors.
3. Open the row: three ✓ checks, 21 items, the transcript at the bottom.
4. Drop the same PDF again: the error panel says it was already uploaded, with the id.
5. Toggle the language to Español: every label on both pages changes.

If step 2 rejects instead: the textarea shows the transcript; find the digit Vision misread (the check table says which sum is off and by how much), fix it, click "Verify again", expect the stored panel. That is the correction flow working; note the misread in the commit message.

- [ ] **Step 9: Commit**

```bash
git add src/components/ReceiptReport.tsx src/components/ReceiptDrop.tsx src/app/receipts src/components/Nav.tsx src/lib/chrome.ts src/lib/i18n.ts
git commit -m "feat(receipts): upload page with correction flow, and the receipt detail page"
```

---

### Task 11: Acceptance suite over the five real receipts

**Files:**
- Create: `web/src/lib/receipts/__fixtures__/expected/<date>.json` (five files, copied)
- Create: `web/src/lib/receipts/acceptance.test.ts`
- Create: `web/src/lib/receipts/replay.test.ts`
- Create: `web/src/lib/receipts/__fixtures__/rows/<date>.rows.txt` (five files, recorded by the acceptance run)
- Modify: `web/package.json` (scripts)
- Copy: the five PDFs to `pdfs/receipts-acceptance/` (gitignored by `pdfs/*`)

**Interfaces:**
- Consumes: `ingestReceipt`, `ReceiptRejected`, `receiptDir` (Task 7); `receiptList`, `receiptDetail` (Task 8); `parseRows` (Task 5); `verify` (Task 6); `parseRowsText` (Task 4); `REPO_ROOT`.
- Produces: `npm run test:receipts`; recorded rows fixtures that `replay.test.ts` runs inside plain `npm test`.

- [ ] **Step 1: Copy the PDFs and the expected JSONs**

From `web/`:

```bash
mkdir -p ../pdfs/receipts-acceptance
cp ~/Desktop/Super/coto_*.pdf ../pdfs/receipts-acceptance/
mkdir -p src/lib/receipts/__fixtures__/expected src/lib/receipts/__fixtures__/rows
for n in 1 2 3 4 5; do
  src="$HOME/Desktop/Super/analisis/datos/week${n}_raw.json"
  d=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['date'])" "$src")
  cp "$src" "src/lib/receipts/__fixtures__/expected/$d.json"
done
ls src/lib/receipts/__fixtures__/expected   # 2026-08-07.json … 2026-09-04.json
```

The expected files are named by the **printed date inside them**, never by the PDF name; the test matches stored receipts to them by date too.

- [ ] **Step 2: Add the script**

In `web/package.json`, `scripts`:

```json
    "test:receipts": "RECEIPT_ACCEPTANCE=1 vitest run src/lib/receipts/acceptance.test.ts"
```

- [ ] **Step 3: Write the acceptance test**

```ts
// web/src/lib/receipts/acceptance.test.ts
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
```

- [ ] **Step 4: Write the offline replay test**

```ts
// web/src/lib/receipts/replay.test.ts
// Every transcript the acceptance run recorded must still pass the gate and land on the
// prototype's totals. Runs in plain `npm test`: no PDF, no OCR, just the parser and the verifier.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseRowsText } from "@/lib/receipts/rows";
import { parseRows } from "@/lib/receipts/parse";
import { verify } from "@/lib/receipts/verify";

const ROWS = path.join(__dirname, "__fixtures__", "rows");
const EXPECTED = path.join(__dirname, "__fixtures__", "expected");
const files = fs.existsSync(ROWS) ? fs.readdirSync(ROWS).filter(f => f.endsWith(".rows.txt")).sort() : [];

describe.skipIf(files.length === 0)("recorded transcripts", () => {
  for (const file of files) {
    const date = file.replace(".rows.txt", "");
    it(`${date} still reconciles`, () => {
      const parsed = parseRows(parseRowsText(fs.readFileSync(path.join(ROWS, file), "utf8")));
      const report = verify(parsed);
      expect(report.errors).toEqual([]);
      expect(report.checks.every(c => c.ok), JSON.stringify(report.checks)).toBe(true);
      const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED, `${date}.json`), "utf8")) as
        { date: string; total_printed: number; items: unknown[] };
      expect(parsed.header.date).toBe(expected.date);
      expect(parsed.footer.totalCents).toBe(Math.round(expected.total_printed * 100));
      expect(parsed.items).toHaveLength(expected.items.length);
    });
  }
});
```

- [ ] **Step 5: Run the acceptance suite, recording**

Run: `RECEIPT_RECORD=1 npm run test:receipts` (macOS, `.venv` set up, ~2–3 minutes).
Expected: 7 tests pass (find, ingest, five `reproduces`), and five files appear in `src/lib/receipts/__fixtures__/rows/`.

If a receipt is rejected, the failure message names the file, the scale and the failing sums; its transcript is saved beside the sandbox path printed in the assertion. Compare the transcript with the expected JSON to see which line Vision misread, then decide: a parser rule (a new OCR spelling of a marker → extend the regex in `parse.ts` with a unit test) or a genuine OCR digit error (the correction flow exists for that; note it in the commit). A description mismatch under 0.9 similarity is a fixture question, not a pipeline bug: check the printed line in the PDF and, if the prototype JSON was the one that was off, correct the fixture and say so in the commit message.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npx vitest run` — everything green, `replay.test.ts` now runs five cases.

```bash
git add package.json src/lib/receipts/acceptance.test.ts src/lib/receipts/replay.test.ts src/lib/receipts/__fixtures__
git commit -m "test(receipts): acceptance suite over the five real receipts, with recorded transcripts"
```

---

### Task 12: Setup documentation

**Files:**
- Modify: `web/README.md` (after the "Phase 3 setup" section)

- [ ] **Step 1: Document the setup**

Append to `web/README.md`:

```markdown
## Supermarket receipts

Receipts (`/receipts`) are read on this machine with Apple Vision, so this part is **macOS only**.
It needs the same Python environment as the statement pipeline, plus the Vision bindings:

```bash
# from the repo root
.venv/bin/pip install -r requirements.txt
```

Uploads land in `pdfs/receipts/<sha256>.pdf` (`TARJETAS_RECEIPT_DIR` to move them). A receipt
that does not reconcile to the cent is not stored; its PDF waits in `pdfs/receipts/.pending/`
until the transcript is corrected on the page, and those files can be deleted at any time.

The acceptance suite runs the real pipeline over `pdfs/receipts-acceptance/`
(`TARJETAS_RECEIPT_ACCEPTANCE_DIR` to point elsewhere) and compares with the verified JSON in
`src/lib/receipts/__fixtures__/expected/`:

```bash
npm run test:receipts                       # ~3 minutes, macOS
RECEIPT_RECORD=1 npm run test:receipts      # also re-records the transcripts replay.test.ts uses
```

Spec: `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: supermarket receipt setup and acceptance run"
```

---

## Self-review

**Spec coverage (P1 sections of `docs/superpowers/specs/2026-09-04-supermarket-receipts.md`):**

| Spec | Task |
|---|---|
| §2 d1 Apple Vision via pyobjc, macOS only | 3 |
| §2 d2 two stages, deterministic parser | 4, 5 |
| §2 d3 article code + EAN captured | 5 (CODE_RE), 7 (columns), 11 (asserted) |
| §2 d4 dedup on ticket number and file hash, no QR | 7 (`storeReceipt`, `ingestReceipt`) |
| §2 d5 nothing stored on failure; editable transcript; corrected endpoint; pending PDF | 7, 9, 10 |
| §2 d7 mupdf, pure Node | 2 |
| §2 d8 PDF kept by hash; transcript kept; PNGs temporary | 2, 3 (temp dir), 7 |
| §2 d11 integer cents / thousandths | 1, 7 |
| §2 d12 one row per discount line, tag M/A | 5, 7 |
| §2 d13 synchronous upload | 9, 10 |
| §2 d14 gated acceptance suite, recorded transcripts | 11 |
| §2 d15 schema inside `migrate()` | 7 |
| §2 d16 `src/lib/receipts/` layout | all |
| §2 d17 routes, nav group, two pages | 9, 10 |
| §2 assumptions: offers mismatch is a warning; 40 MB cap; chain `coto`; file name unused | 6, 7, 7, 7/9 |
| §3 pipeline steps 1–8 | 7 orchestrates 2, 3, 4, 5, 6 |
| §4 data model | 7 |
| §5 parsing rules (amounts, qty line, unit, code line, discount variants, `=`, `?`, header anywhere, offers by order) | 1, 5 |
| §6 gate, errors, warnings, report shape | 6 |
| §7 failure flow, rows text format with tab or two spaces | 4, 7, 9, 10 |
| §10 UI: list, detail, report, footer, i18n, no `<h1>` | 10 |
| §11 acceptance rules (by date, exact numbers, 0.9 similarity, `?` wildcard, tags, codes) | 11 |
| §12 setup | 3, 12 |

Not in P1 by design: §8 analytics, §9 charge links (P2/P3 plans).

**Placeholder scan:** no "TBD", "TODO", "similar to Task N", or "add validation" phrases; every code step carries the code; every test step carries the test.

**Type consistency:** `Box`, `Row`, `PageImage`, `ParsedReceipt` and friends, `VerificationReport`, `ReceiptStored`, `ReceiptFailure`, `ReceiptDeps` are named identically in the type table, their defining task, and every consumer (Tasks 7, 8, 9, 10, 11). `verify(parsed)` takes one argument everywhere. `ingestReceipt(db, bytes, deps?)` and `ingestCorrected(db, sha256, rowsText)` match between Task 7, Task 9 and the tests. `receiptDetail` returns `{ receipt, header, items, report, transcript }` and Task 10 destructures exactly those.
