import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as mupdf from "mupdf";
import { Failure } from "@/lib/failure";
import { REPO_ROOT, resolvePython } from "@/lib/upload";
import type { PageImage } from "./pdf";
import { planSlices, cropSlice, mapBoxToPage, dedupeBoxes, type SlicePlan } from "./slice";

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

// One chunk handed to the OCR script: which real page it came from, its pixel slice within that
// page, the page's own pixel height (needed to turn the slice-local fraction Vision returns back
// into a whole-page fraction), and the PNG bytes to write out.
type Chunk = { page: number; slice: SlicePlan; pageHeight: number; png: Buffer };

/**
 * Split every page image into overlapping horizontal slices (mupdf's own pixmap warp does the
 * cropping — no other image library involved). A page whose aspect ratio doesn't call for
 * slicing comes back as its single original PNG, untouched.
 */
function sliceIntoChunks(pages: PageImage[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const p of pages) {
    const plans = planSlices(p.width, p.height);
    if (plans.length === 1) {
      chunks.push({ page: p.page, slice: plans[0], pageHeight: p.height, png: p.png });
      continue;
    }
    const image = new mupdf.Image(p.png);
    try {
      const pix = image.toPixmap();
      try {
        for (const slice of plans) {
          const cropped = cropSlice(pix, p.width, slice);
          try {
            chunks.push({ page: p.page, slice, pageHeight: p.height, png: Buffer.from(cropped.asPNG()) });
          } finally {
            cropped.destroy();
          }
        }
      } finally {
        pix.destroy();
      }
    } finally {
      image.destroy();
    }
  }
  return chunks;
}

/**
 * Apple Vision, through scripts/ocr_receipt.py in the same venv the statement pipeline uses.
 * Each page is sliced into overlapping horizontal chunks first (a very tall, narrow page is
 * Vision's worst case — it normalises the input, so small text on a 4000px-tall page loses the
 * pixel height it needs); every chunk goes through Vision as its own image, and every box it
 * returns is mapped back into whole-page fractions before duplicates from the overlaps are
 * dropped. `Box.x/y/w/h` stay fractions of the *whole page* — that contract does not change.
 * The pages go through a temp directory because Vision reads files; it is removed whatever
 * happens. Same env allowlist as runPipeline: the child never sees ANTHROPIC_API_KEY.
 */
export async function ocrPages(pages: PageImage[]): Promise<Box[]> {
  const python = resolvePython();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-ocr-"));
  try {
    const chunks = sliceIntoChunks(pages);
    const files = chunks.map((c, i) => {
      const file = path.join(dir, `chunk-${i}.png`);
      fs.writeFileSync(file, c.png);
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
      if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        throw new Failure("ocr_failed", "failure.ocr_failed.tooMuchOutput");
      if (err.killed)
        throw new Failure("ocr_failed", "failure.ocr_failed.timeout", { seconds: TIMEOUT_MS / 1000 });
      throw new Failure("ocr_failed", "failure.ocr_failed.detail", { detail: stderr || err.message });
    }
    // The script numbers boxes by argv position ("page" 1-based), which is the chunk index here,
    // not the real page number — map each box back to its chunk's real page and pixel slice.
    let raw: Box[];
    try {
      raw = stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line) as Box);
    } catch (e) {
      throw new Failure("ocr_failed", "failure.ocr_failed.detail", { detail: (e as Error).message });
    }
    const mapped = raw.map(box => {
      const chunkIndex = box.page; // 1-based, matches the chunk this box's slice came from
      const chunk = chunks[chunkIndex - 1];
      const localCenter = box.y + box.h / 2;
      // How far this reading sits from either edge of its own crop: Vision reads worse right at
      // a cut, so between two duplicate readings of the same line, prefer the more central one.
      const centrality = Math.min(localCenter, 1 - localCenter);
      return { ...mapBoxToPage(box, chunk.slice, chunk.pageHeight), page: chunk.page, source: chunkIndex, score: centrality };
    });
    return dedupeBoxes(mapped).map(({ source: _source, score: _score, ...box }) => box);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
