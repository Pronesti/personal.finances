import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonDir, resolvePython, runPipeline } from "@/lib/upload";
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
