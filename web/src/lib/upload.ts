import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "@/lib/paths";
import { Failure } from "@/lib/failure";

const execFileP = promisify(execFile);

// data/ is the one path knob the app already has; everything else hangs off its parent.
export const REPO_ROOT = path.resolve(DATA_DIR, "..");

// Read at call time, not at import: the env override is the test seam, so no public signature
// needs a directory parameter and no test writes into the repo's real statement folders.
export function pdfDir(): string {
  return process.env.TARJETAS_PDF_DIR ?? path.join(REPO_ROOT, "pdfs");
}
export function jsonDir(): string {
  return process.env.TARJETAS_JSON_DIR ?? path.join(REPO_ROOT, "json");
}
function script(): string {
  return process.env.TARJETAS_PDF_SCRIPT ?? path.join(REPO_ROOT, "scripts", "pdf_to_json.py");
}

const TIMEOUT_MS = 120_000;
const SETUP_HINT =
  "From the repo root: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt";

// The system python3 deliberately does NOT count: it has no pdfplumber on this machine, and
// silently picking it turns a fixable setup problem into an unreadable traceback.
export function resolvePython(): string {
  const explicit = process.env.TARJETAS_PYTHON;
  if (explicit) return explicit;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python3");
  if (fs.existsSync(venv)) return venv;
  throw new Failure("python_missing", "No Python environment for the PDF pipeline.", SETUP_HINT);
}

function tail(s: string, n = 3): string {
  return s.split("\n").map(l => l.trim()).filter(Boolean).slice(-n).join(" — ");
}

// execFile, not exec: argv array, no shell, so a filename can never become a command. The child
// gets an explicit env — process.env would hand ANTHROPIC_API_KEY to Python for no reason.
export async function runPipeline(pdfPath: string): Promise<string> {
  const target = path.join(jsonDir(), path.basename(pdfPath).replace(/\.pdf$/i, ".json"));
  try {
    await execFileP(resolvePython(), [script(), pdfPath], {
      cwd: REPO_ROOT,
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        // An allowlist, not process.env: the parent holds ANTHROPIC_API_KEY and Python has no
        // business seeing it. NODE_ENV is here only because Next's types make it required.
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        LC_ALL: "C.UTF-8",
        // The stub tests read this; the real script derives its own paths from __file__.
        TARJETAS_JSON_DIR: process.env.TARJETAS_JSON_DIR ?? "",
      },
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string; code?: string | number; killed?: boolean };
    const stderr = tail(err.stderr ?? "");
    if (err.code === "ENOENT")
      throw new Failure("python_missing", `Cannot run ${resolvePython()}.`, SETUP_HINT);
    if (stderr.includes("ModuleNotFoundError"))
      throw new Failure("python_missing", "The Python environment is missing pdfplumber.", SETUP_HINT);
    if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new Failure("parse_failed", "pdf_to_json.py produced more output than expected.");
    if (err.killed)
      throw new Failure("parse_failed", `pdf_to_json.py timed out after ${TIMEOUT_MS / 1000}s.`);
    // Exit 2 is the script's "this is not a readable statement" contract; exit 1 is a layout it
    // does not recognise. Different messages, different advice.
    if (err.code === 2)
      throw new Failure("not_pdf", stderr || "The file could not be read as a PDF.");
    throw new Failure("parse_failed", stderr || err.message);
  }
  if (!fs.existsSync(target))
    throw new Failure("parse_failed", `pdf_to_json.py produced no JSON for ${path.basename(pdfPath)}.`);
  return target;
}
