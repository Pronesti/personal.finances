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
