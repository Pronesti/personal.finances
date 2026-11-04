/** Explicit copied-source OCR rehearsal. Writes only a temporary SQLite/files sandbox. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

type Result = { engine: string; fixtureId: string; accepted: boolean; correctionSucceeded: boolean; centsDelta: number | null; durationMs: number; errorCode: string | null };
type Expected = { total_printed: number; items: { qty: number; unit_price: number | null; line_total: number; discount: number }[] };
function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
function privateFile(directory: string, filename: string): string | undefined {
  const file = path.join(directory, filename);
  if (!fs.existsSync(file)) return undefined;
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error("unsafe_input");
  return file;
}
async function main(): Promise<void> {
  // tsx treats this package's .ts entrypoint as CJS, while MuPDF requires ESM with
  // top-level await. Bundle only local TS into a disposable ESM entrypoint; keep
  // installed packages external so native SQLite and MuPDF/WASM stay intact.
  if (process.env.ACCOUNTING_OCR_BUNDLED !== "1") {
    const output = argument("--output");
    if (!output) throw new Error("explicit_output_required");
    const executable = path.join(path.dirname(path.resolve(output)), `.ocr-benchmark-${process.pid}.mjs`);
    const resolver = createRequire(path.join(process.cwd(), "package.json"));
    const { build } = await import("esbuild");
    try {
      await build({ entryPoints: [path.join(process.cwd(), "scripts/accounting-ocr-benchmark.ts")], outfile: executable,
        bundle: true, platform: "node", format: "esm", tsconfig: path.join(process.cwd(), "tsconfig.json"), logLevel: "silent",
        plugins: [{ name: "installed-packages", setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, args => {
            if (args.path.startsWith("node:") || args.path.startsWith("@/")) return undefined;
            return { path: resolver.resolve(args.path), external: true };
          });
        } }],
      });
      fs.chmodSync(executable, 0o600);
      const child = spawnSync(process.execPath, [executable, ...process.argv.slice(2)], {
        env: { ...process.env, ACCOUNTING_OCR_BUNDLED: "1" }, stdio: "inherit",
      });
      process.exitCode = child.status ?? 1;
      return;
    } finally { fs.rmSync(executable, { force: true }); }
  }
  const { openDb } = await import("../src/lib/db");
  const { Failure } = await import("../src/lib/failure");
  const { REPO_ROOT, resolvePython } = await import("../src/lib/upload");
  const { ingestReceipt, ingestCorrected, ReceiptRejected, sha256 } = await import("../src/lib/receipts/ingest");
  const { receiptDetail } = await import("../src/lib/receipts/queries");
  const { validateRuntime } = await import("../src/lib/accounting/runtime");
  const supplied = argument("--receipt-dir"), output = argument("--output");
  if (!supplied || !output || !process.argv.includes("--copied-source")) throw new Error("explicit_copied_source_and_output_required");
  const source = fs.realpathSync(supplied);
  if (source === path.join(REPO_ROOT, "pdfs") || source.startsWith(path.join(REPO_ROOT, "pdfs") + path.sep)) throw new Error("live_source_refused");
  const files = fs.readdirSync(source).filter(name => name.toLowerCase().endsWith(".pdf")).sort();
  if (files.length === 0) throw new Error("no_pdf_fixtures");
  if (process.platform !== "darwin") throw new Error("apple_vision_requires_macos");
  if (process.env.TARJETAS_OCR_SCRIPT && path.resolve(process.env.TARJETAS_OCR_SCRIPT) !== path.join(REPO_ROOT, "scripts", "ocr_receipt.py")) throw new Error("unverified_ocr_script");
  const python = resolvePython();
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "accounting-ocr-")));
  const documentRoot = path.join(temp, "documents"), referenceRoot = path.join(temp, "references");
  fs.mkdirSync(documentRoot, { mode: 0o700 }); fs.mkdirSync(referenceRoot, { mode: 0o700 });
  const previous = process.env.TARJETAS_RECEIPT_DIR;
  process.env.TARJETAS_RECEIPT_DIR = documentRoot;
  const results: Result[] = [];
  const expectedDir = argument("--expected-dir"), correctionDir = argument("--correction-dir");
  try {
    const readiness = validateRuntime({ backend: "sqlite", databaseUrl: undefined, documentRoot, referenceRoot, parserExecutable: python, ocrExecutable: python });
    if (!readiness.ok) throw new Error(readiness.errors.join(","));
    // Sequential: preserve the current bounded process path and avoid parallel large rasters.
    for (const name of files) {
      const file = privateFile(source, name)!;
      const bytes = fs.readFileSync(file);
      const result: Result = { engine: "apple-vision", fixtureId: createHash("sha256").update(bytes).digest("hex"), accepted: false, correctionSucceeded: false, centsDelta: null, durationMs: 0, errorCode: null };
      const start = performance.now();
      const db = openDb(":memory:");
      try {
        let stored;
        try { stored = await ingestReceipt(db, bytes); result.accepted = true; }
        catch (error) {
          if (!(error instanceof ReceiptRejected)) throw error;
          const total = error.payload.report.checks.find(check => check.name === "total");
          result.centsDelta = total?.printed === null || total?.printed === undefined ? null : total.computed - total.printed;
          result.errorCode = "receipt_rejected";
          const corrected = correctionDir ? privateFile(correctionDir, `${sha256(bytes)}.rows.txt`) : undefined;
          if (corrected) {
            stored = await ingestCorrected(db, sha256(bytes), fs.readFileSync(corrected, "utf8"));
            result.correctionSucceeded = true;
          }
        }
        if (stored) {
          result.centsDelta = 0;
          if (expectedDir) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(stored.date)) throw new Error("expected_date_invalid");
            const expectedFile = privateFile(expectedDir, `${stored.date}.json`);
            if (!expectedFile) throw new Error("expected_fixture_missing");
            const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8")) as Expected;
            const detail = receiptDetail(db, stored.id)!;
            result.centsDelta = stored.totalCents - Math.round(expected.total_printed * 100);
            const match = detail.items.length === expected.items.length && detail.items.every((item, i) => {
              const wanted = expected.items[i];
              return item.qty_milli === Math.round(wanted.qty * 1000)
                && item.line_total_cents === Math.round(wanted.line_total * 100)
                && item.unit_price_cents === (wanted.unit_price === null ? null : Math.round(wanted.unit_price * 100))
                && item.discounts.reduce((sum, discount) => sum + discount.amount_cents, 0) === Math.round(wanted.discount * 100);
            });
            if (result.centsDelta !== 0 || !match) throw new Error("expected_fixture_mismatch");
          }
        }
      } catch (error) {
        result.accepted = false;
        result.correctionSucceeded = false;
        result.errorCode = error instanceof Failure ? error.code : error instanceof ReceiptRejected ? "correction_rejected" : error instanceof Error && error.message.startsWith("expected_") ? error.message : "benchmark_failed";
      } finally { db.close(); result.durationMs = Math.round(performance.now() - start); }
      results.push(result);
    }
    fs.writeFileSync(output, JSON.stringify(results, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ engine: "apple-vision", fixtures: results.length, accepted: results.filter(r => r.accepted).length, corrected: results.filter(r => r.correctionSucceeded).length, failed: results.filter(r => !r.accepted && !r.correctionSucceeded).length }));
    if (results.some(result => !result.accepted && !result.correctionSucceeded)) process.exitCode = 1;
  } finally {
    if (previous === undefined) delete process.env.TARJETAS_RECEIPT_DIR; else process.env.TARJETAS_RECEIPT_DIR = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(() => { console.error(JSON.stringify({ errorCode: "benchmark_setup_failed" })); process.exitCode = 1; });
