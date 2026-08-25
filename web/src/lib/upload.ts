import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { DATA_DIR } from "@/lib/paths";
import { Failure } from "@/lib/failure";
import { ingestFile, type IngestReport } from "@/lib/ingest";
import { loadRules } from "@/lib/categorize";
import { loadAliases } from "@/lib/aliases";
import { loadCpi, latestMonth } from "@/lib/cpi";
import type { StatementJson } from "@/lib/integrity";

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
  // Resolved OUTSIDE the try: its "no venv" Failure already says exactly what to do, and being
  // caught below would reclassify it as parse_failed and drop the hint.
  const python = resolvePython();
  try {
    await execFileP(python, [script(), pdfPath], {
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
    if (e instanceof Failure) throw e; // already classified, and better than anything below
    const err = e as { stderr?: string; message: string; code?: string | number; killed?: boolean };
    const stderr = tail(err.stderr ?? "");
    if (err.code === "ENOENT")
      throw new Failure("python_missing", `Cannot run ${python}.`, SETUP_HINT);
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

// ---------------------------------------------------------------------------
// Upload: uploaded bytes -> database rows
// ---------------------------------------------------------------------------

// The largest real statement in pdfs/ is 384 KB; 10 MB is generous and still bounds memory.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pdf$/i;

export type UploadReport = IngestReport & { cpi_stale: boolean };

// The uploaded name decides where the pipeline writes its JSON, so an unchecked name is an
// arbitrary-write primitive. basename() drops any directory the browser sent — traversal
// included — and the regex then admits only a flat filename. Requiring a leading alphanumeric
// also stops a name like "-rf.pdf" from being read as a flag in the child's argv.
export function safePdfName(raw: string): string {
  const base = path.basename(raw.trim());
  if (!NAME_RE.test(base))
    throw new Failure("bad_name", `"${raw}" is not a usable PDF filename.`,
      "Rename it to letters, digits, dots, dashes or underscores, ending in .pdf.");
  return base;
}

export async function ingestUpload(
  db: Database.Database, bytes: Buffer, rawName: string
): Promise<UploadReport> {
  const name = safePdfName(rawName);
  if (bytes.byteLength > MAX_PDF_BYTES)
    throw new Failure("too_large", `${name} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new Failure("not_pdf", `${name} does not start with %PDF- — it is not a PDF.`);

  fs.mkdirSync(pdfDir(), { recursive: true });
  fs.mkdirSync(jsonDir(), { recursive: true });
  // Land on a temp path first. pdfs/ is gitignored, so overwriting a real statement with a file
  // that then fails to parse would destroy the only copy of the source with nothing to show for it.
  // The temp name must still end in .pdf: the pipeline derives its JSON filename from the PDF's
  // stem, so a ".tmp" suffix would make Python and this module disagree about where it landed.
  const stem = name.replace(/\.pdf$/i, "");
  const tmpPdf = path.join(pdfDir(), `${stem}.upload.pdf`);
  const finalPdf = path.join(pdfDir(), name);
  fs.writeFileSync(tmpPdf, bytes);

  let report: IngestReport;
  let producedJson: string;
  try {
    producedJson = await runPipeline(tmpPdf);
    let json: StatementJson;
    try {
      json = JSON.parse(fs.readFileSync(producedJson, "utf8")) as StatementJson;
    } catch (e) {
      throw new Failure("parse_failed", `${path.basename(producedJson)} is not readable JSON: ${(e as Error).message}`);
    }
    // The pipeline named the JSON after the temp file; the statement is named after the upload.
    json = { ...json, file: name };
    try {
      report = ingestFile(db, json, loadRules(), loadAliases());
    } catch (e) {
      throw new Failure("ingest_failed", `${name} parsed but could not be ingested: ${(e as Error).message}`);
    }
  } catch (e) {
    fs.rmSync(tmpPdf, { force: true });
    throw e;
  }

  // Committed: move the JSON and the PDF onto their real names, then clear what they superseded.
  const finalJson = path.join(jsonDir(), name.replace(/\.pdf$/i, ".json"));
  fs.renameSync(producedJson, finalJson);
  fs.renameSync(tmpPdf, finalPdf);
  for (const old of report.replaced) {
    if (old === name) continue;
    // Leaving the old JSON behind would let `npm run ingest` re-create the statement this
    // upload just superseded, with ASCII sort order deciding which copy wins.
    fs.rmSync(path.join(jsonDir(), old.replace(/\.pdf$/i, ".json")), { force: true });
    const supersededDir = path.join(pdfDir(), ".superseded");
    fs.mkdirSync(supersededDir, { recursive: true });
    fs.rmSync(path.join(supersededDir, old), { force: true });
    if (fs.existsSync(path.join(pdfDir(), old)))
      fs.renameSync(path.join(pdfDir(), old), path.join(supersededDir, old));
  }
  return { ...report, cpi_stale: report.cycle_month > latestMonth(loadCpi()) };
}
