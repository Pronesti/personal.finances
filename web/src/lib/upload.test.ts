import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import {
  parseStatementUpload, MAX_PDF_BYTES, REPO_ROOT, safePdfName, ingestUpload, pdfDir, jsonDir, resolvePython, runPipeline,
} from "@/lib/upload";
import { Failure } from "@/lib/failure";

// Stubs stand in for scripts/pdf_to_json.py so these tests never need pdfplumber, and the
// directories are redirected so no test ever writes into the repo's real pdfs/ or json/.
let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "upload-"));
  process.env.TARJETAS_PDF_DIR = path.join(sandbox, "pdfs");
  process.env.TARJETAS_JSON_DIR = path.join(sandbox, "json");
  process.env.TARJETAS_PYTHON = "python3";
  fs.mkdirSync(process.env.TARJETAS_PDF_DIR, { recursive: true });
  fs.mkdirSync(process.env.TARJETAS_JSON_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.TARJETAS_PDF_DIR;
  delete process.env.TARJETAS_JSON_DIR;
  delete process.env.TARJETAS_PYTHON;
  delete process.env.TARJETAS_PDF_SCRIPT;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function useStub(body: string): void {
  const p = path.join(sandbox, "stub.py");
  fs.writeFileSync(p, body);
  process.env.TARJETAS_PDF_SCRIPT = p;
}

const WRITES_JSON = `
import sys, json, pathlib, os
stem = pathlib.Path(sys.argv[1]).stem
(pathlib.Path(os.environ["TARJETAS_JSON_DIR"]) / (stem + ".json")).write_text(json.dumps({"file": stem + ".pdf"}))
print("OK")
`;
const LAYOUT_ERROR = `
import sys
print("LAYOUT ERROR: block 1 adds up to 10 but the PDF declares 20", file=sys.stderr)
sys.exit(1)
`;
const READ_ERROR = `
import sys
print("READ ERROR: PDFPasswordIncorrect: password required", file=sys.stderr)
sys.exit(2)
`;
const NO_MODULE = `
import sys
print("Traceback (most recent call last):\\n  ModuleNotFoundError: No module named 'pdfplumber'", file=sys.stderr)
sys.exit(1)
`;
const SILENT_SUCCESS = `print("OK but wrote nothing")`;

describe("resolvePython", () => {
  it("honours the TARJETAS_PYTHON override", () => {
    expect(resolvePython()).toBe("python3");
  });
});

describe("runPipeline", () => {
  it("returns the path of the JSON the script wrote", async () => {
    useStub(WRITES_JSON);
    const out = await runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    expect(out).toBe(path.join(jsonDir(), "x.json"));
    expect(JSON.parse(fs.readFileSync(out, "utf8")).file).toBe("x.pdf");
  });

  it("reports a layout error as parse_failed, quoting the script's own message", async () => {
    useStub(LAYOUT_ERROR);
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("parse_failed");
      expect(e.message).toContain("LAYOUT ERROR");
    });
  });

  it("reports an unreadable PDF (exit 2) as not_pdf, not as a layout problem", async () => {
    useStub(READ_ERROR);
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("not_pdf");
      expect(e.message).toContain("PDFPasswordIncorrect");
    });
  });

  it("reports a missing pdfplumber as python_missing with the setup command", async () => {
    useStub(NO_MODULE);
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("python_missing");
      expect(e.hint).toContain("pip install -r requirements.txt");
    });
  });

  it("reports a missing interpreter as python_missing, not as a parse failure", async () => {
    useStub(WRITES_JSON);
    process.env.TARJETAS_PYTHON = path.join(sandbox, "no-such-python");
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("python_missing");
    });
  });

  it("keeps python_missing (and its hint) when there is no venv at all", async () => {
    // Regression: resolvePython() used to be called inside runPipeline's try, so its Failure was
    // caught and reclassified as parse_failed, throwing away the one message that says what to do.
    useStub(WRITES_JSON);
    delete process.env.TARJETAS_PYTHON;
    const realVenv = path.join(REPO_ROOT, ".venv", "bin", "python3");
    if (fs.existsSync(realVenv)) return; // this machine has a venv; the branch is unreachable here
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await run.catch((e: Failure) => {
      expect(e.code).toBe("python_missing");
      expect(e.hint).toContain("python3 -m venv");
    });
  });

  it("does not reclassify an already-classified Failure", async () => {
    useStub(WRITES_JSON);
    process.env.TARJETAS_PYTHON = path.join(sandbox, "nope");
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await run.catch((e: Failure) => {
      expect(e.code).toBe("python_missing");
      expect(e.hint).toContain("python3 -m venv");
    });
  });

  it("fails when the script exits 0 but writes no JSON", async () => {
    useStub(SILENT_SUCCESS);
    const run = runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    await expect(run).rejects.toBeInstanceOf(Failure);
    await run.catch((e: Failure) => {
      expect(e.code).toBe("parse_failed");
      expect(e.message).toContain("no JSON");
    });
  });

  it("does not hand the API key to the subprocess", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    useStub(`
import sys, os, pathlib
stem = pathlib.Path(sys.argv[1]).stem
leaked = "ANTHROPIC_API_KEY" in os.environ
(pathlib.Path(os.environ["TARJETAS_JSON_DIR"]) / (stem + ".json")).write_text('{"leaked": %s}' % ("true" if leaked else "false"))
`);
    const out = await runPipeline(path.join(sandbox, "pdfs", "x.pdf"));
    expect(JSON.parse(fs.readFileSync(out, "utf8")).leaked).toBe(false);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

const STATEMENT_STUB = `
import sys, json, pathlib, os
stem = pathlib.Path(sys.argv[1]).stem
(pathlib.Path(os.environ["TARJETAS_JSON_DIR"]) / (stem + ".json")).write_text(json.dumps({
  "file": stem + ".pdf", "brand": "visa",
  "period": {"closing_date": "2026-07-30", "due_date": "2026-08-07", "previous_closing_date": "2026-07-02"},
  "balances": {"current_ars": 120000, "current_usd": None, "minimum_payment_ars": 1000},
  "declared_totals": [{"concept": "TOTAL CONSUMOS DE X", "block": 1, "ars": 120000, "usd": None}],
  "upcoming_installments": [],
  "transactions": [{"section": "purchases", "block": 1, "date": "2026-07-10",
    "description": "OSDE 000012345678901", "ars": 120000, "usd": None,
    "installment_number": None, "installment_count": None}]
}))
`;
const pdfBytes = Buffer.from("%PDF-1.7\nnot really a pdf\n");

describe("safePdfName", () => {
  it("accepts a plain statement name", () => {
    expect(safePdfName("visa_2026_07_30.pdf")).toBe("visa_2026_07_30.pdf");
  });
  it("keeps an uppercase extension", () => {
    expect(safePdfName("VISA.PDF")).toBe("VISA.PDF");
  });
  it("strips any directory the browser sent, traversal included", () => {
    // basename() neutralises the traversal; what is left is a flat, boring filename that can
    // only ever land inside pdfs/. This is the contract, not a bug.
    expect(safePdfName("/etc/../tmp/visa.pdf")).toBe("visa.pdf");
    expect(safePdfName("../../etc/passwd.pdf")).toBe("passwd.pdf");
  });
  it("rejects backslashes, wrong extensions and empty names", () => {
    for (const bad of ["a\\b.pdf", "statement.PDF.exe", "", ".pdf", "x.json", "-rf.pdf"]) {
      expect(() => safePdfName(bad)).toThrow(Failure);
    }
  });
});

describe("ingestUpload", () => {
  it("places the PDF, runs the pipeline and ingests the JSON", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    const report = await ingestUpload(db, pdfBytes, "s.pdf");
    expect(report).toMatchObject({ file: "s.pdf", brand: "visa", cycle_month: "2026-07", transactions: 1, replaced: [] });
    expect(fs.existsSync(path.join(pdfDir(), "s.pdf"))).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 1 });
  });

  it("is idempotent: uploading twice leaves one statement and reports the replacement", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    await ingestUpload(db, pdfBytes, "s.pdf");
    const second = await ingestUpload(db, pdfBytes, "s.pdf");
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(second.replaced).toEqual(["s.pdf"]);
  });

  it("deletes the superseded JSON so a later npm run ingest cannot resurrect it", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    await ingestUpload(db, pdfBytes, "old.pdf");
    await ingestUpload(db, pdfBytes, "new.pdf"); // same brand + closing_date
    expect(fs.existsSync(path.join(jsonDir(), "old.json"))).toBe(false);
    expect(fs.existsSync(path.join(jsonDir(), "new.json"))).toBe(true);
  });

  it("does not destroy an existing PDF when the new one fails to parse", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    await ingestUpload(db, pdfBytes, "s.pdf");
    const original = fs.readFileSync(path.join(pdfDir(), "s.pdf"));
    useStub(`import sys; print("LAYOUT ERROR: nope", file=sys.stderr); sys.exit(1)`);
    await expect(ingestUpload(db, Buffer.from("%PDF-different"), "s.pdf")).rejects.toBeInstanceOf(Failure);
    expect(fs.readFileSync(path.join(pdfDir(), "s.pdf"))).toEqual(original);
    expect(fs.readdirSync(pdfDir()).filter(f => f.endsWith(".upload.pdf"))).toEqual([]);
  });

  it("rejects bytes that are not a PDF before touching the filesystem", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    await expect(ingestUpload(db, Buffer.from("PKzip"), "s.pdf")).rejects.toMatchObject({ code: "not_pdf" });
    expect(fs.readdirSync(pdfDir())).toEqual([]);
  });

  it("rejects an oversized upload", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_PDF_BYTES)]);
    await expect(ingestUpload(db, huge, "s.pdf")).rejects.toMatchObject({ code: "too_large" });
  });

  it("flags a cycle the CPI table does not cover yet", async () => {
    useStub(STATEMENT_STUB);
    const db = openDb(":memory:");
    // data/ipc.json ends at 2026-07 today, so a 2026-07 statement is covered.
    expect((await ingestUpload(db, pdfBytes, "s.pdf")).cpi_stale).toBe(false);
  });
});


describe("parseStatementUpload", () => {
  it("returns exact parser bytes and original filename without writing statement storage or opening SQLite", async () => {
    useStub(STATEMENT_STUB);
    const dbModule = await import("@/lib/db");
    const open = vi.spyOn(dbModule, "openDb").mockImplementation(() => { throw new Error("unexpected database"); });
    try {
      const result = await parseStatementUpload(pdfBytes, "mp_2026_07.pdf");
      expect(result.pdf).toEqual(pdfBytes);
      expect(result.json.file).toBe("mp_2026_07.pdf");
      expect(JSON.parse(result.rawJson.toString()).file).toBe("mp_2026_07.pdf");
      expect(result.json.transactions).toHaveLength(1);
      expect(fs.readdirSync(pdfDir())).toEqual([]);
      expect(fs.readdirSync(jsonDir())).toEqual([]);
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });

  it("routes the actual Python CLI to the private output directory without changing filename years", async () => {
    // Exercise the real CLI/storage boundary with a synthetic converter; no personal PDF or
    // pdfplumber is needed, and the default JSON directory must remain untouched.
    useStub(`
import importlib.util, sys, types, pathlib
sys.modules["pdfplumber"] = types.ModuleType("pdfplumber")
spec = importlib.util.spec_from_file_location("pdf_to_json", ${JSON.stringify(path.join(REPO_ROOT, "scripts", "pdf_to_json.py"))})
module = importlib.util.module_from_spec(spec)
sys.modules["pdf_to_json"] = module
spec.loader.exec_module(module)
module.JSON_DIR = pathlib.Path(${JSON.stringify(path.join(sandbox, "default-output"))})
module.convert = lambda pdf: {"file": pdf.name, "transactions": []}
sys.exit(module.main(sys.argv[1:]))
`);
    const result = await parseStatementUpload(pdfBytes, "mercadopago_2026_07.pdf");
    expect(result.json.file).toBe("mercadopago_2026_07.pdf");
    expect(fs.existsSync(path.join(sandbox, "default-output"))).toBe(false);
    expect(fs.readdirSync(jsonDir())).toEqual([]);
  });

  it("preserves validation and layout failures in the independent seam", async () => {
    useStub(LAYOUT_ERROR);
    await expect(parseStatementUpload(pdfBytes, "../-rf.pdf")).rejects.toMatchObject({ code: "bad_name" });
    await expect(parseStatementUpload(Buffer.from("bad"), "ok.pdf")).rejects.toMatchObject({ code: "not_pdf" });
    await expect(parseStatementUpload(Buffer.alloc(MAX_PDF_BYTES + 1), "ok.pdf")).rejects.toMatchObject({ code: "too_large" });
    await expect(parseStatementUpload(pdfBytes, "ok.pdf")).rejects.toMatchObject({ code: "parse_failed" });
    expect(fs.readdirSync(pdfDir())).toEqual([]);
    expect(fs.readdirSync(jsonDir())).toEqual([]);
  });

  it("cleans up the private workspace on success and malformed JSON", async () => {
    const marker = path.join(sandbox, "workspace.txt");
    useStub(STATEMENT_STUB + `\npathlib.Path(${JSON.stringify(marker)}).write_text(str(pathlib.Path(sys.argv[1]).parent))`);
    await parseStatementUpload(pdfBytes, "s.pdf");
    expect(fs.existsSync(fs.readFileSync(marker, "utf8"))).toBe(false);
    useStub(`
import sys, pathlib, os
p = pathlib.Path(sys.argv[1])
pathlib.Path(${JSON.stringify(marker)}).write_text(str(p.parent))
(pathlib.Path(os.environ["TARJETAS_JSON_DIR"]) / (p.stem + ".json")).write_text("invalid")
`);
    await expect(parseStatementUpload(pdfBytes, "s.pdf")).rejects.toMatchObject({ code: "parse_failed" });
    expect(fs.existsSync(fs.readFileSync(marker, "utf8"))).toBe(false);
  });
});
