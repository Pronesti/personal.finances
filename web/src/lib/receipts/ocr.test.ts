import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as mupdf from "mupdf";
import { ocrPages } from "@/lib/receipts/ocr";
import { planSlices } from "@/lib/receipts/slice";
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

  describe("slicing a tall page before OCR", () => {
    // A real, mupdf-decodable PNG (built directly from a Pixmap, no PDF involved) tall enough
    // that planSlices splits it into several overlapping chunks.
    function tallPng(width: number, height: number): Buffer {
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
      try {
        pix.clear(255);
        return Buffer.from(pix.asPNG());
      } finally {
        pix.destroy();
      }
    }

    it("sends one chunk per slice to the OCR script, not one file per page", async () => {
      const width = 200, height = 1600;
      const plans = planSlices(width, height);
      expect(plans.length).toBeGreaterThan(1); // otherwise this test proves nothing
      // Hand the received file count back via "text" so ocrPages can still parse it as a Box.
      useStub(`
import sys, json
print(json.dumps({"page": 1, "x": 0, "y": 0, "w": 0, "h": 0, "text": str(len(sys.argv) - 1)}))
`);
      const [box] = await ocrPages([{ page: 1, png: tallPng(width, height), width, height }]);
      expect(box.text).toBe(String(plans.length));
    });

    it("maps a box found in a lower slice to a whole-page fraction, and dedupes an overlap duplicate", async () => {
      const width = 200, height = 1600;
      const plans = planSlices(width, height);
      const j = 0;
      // The overlap band shared by slice j and slice j+1, in whole-page pixels.
      const overlapStart = plans[j + 1].y0;
      const overlapEnd = plans[j].y1;
      expect(overlapEnd).toBeGreaterThan(overlapStart); // must actually overlap
      const targetPx = (overlapStart + overlapEnd) / 2;
      const hFrac = 0.004;
      const localY = (s: { y0: number; y1: number }) => (targetPx - s.y0) / (s.y1 - s.y0);
      // Chunks are numbered 1-based by argv position == slice index + 1.
      const chunkForJ = j + 1;
      const chunkForJPlus1 = j + 2;
      const boxes: Record<number, { x: number; y: number; w: number; h: number; text: string }[]> = {
        [chunkForJ]: [{ x: 0.1, y: localY(plans[j]), w: 0.3, h: hFrac, text: "DUPLICATE LINE" }],
        [chunkForJPlus1]: [{ x: 0.1, y: localY(plans[j + 1]), w: 0.3, h: hFrac, text: "DUPLICATE LINE" }],
      };
      useStub(`
import sys, json
boxes = ${JSON.stringify(boxes)}
for page, p in enumerate(sys.argv[1:], start=1):
    for b in boxes.get(str(page), []):
        print(json.dumps({"page": page, **b}))
`);
      const result = await ocrPages([{ page: 1, png: tallPng(width, height), width, height }]);
      const dup = result.filter(b => b.text === "DUPLICATE LINE");
      expect(dup).toHaveLength(1);
      expect(dup[0].page).toBe(1);
      expect(dup[0].y).toBeCloseTo(targetPx / height, 2);
    });

    it("does not slice (or otherwise alter) a page whose aspect ratio doesn't call for it", async () => {
      useStub(ECHO_PAGES);
      const boxes = await ocrPages(pages); // the module-level `pages` fixture is 10x10, square
      expect(boxes).toEqual([
        { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.01, text: "TOTAL" },
        { page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.01, text: "TOTAL" },
      ]);
    });
  });
});
