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
