import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type RuntimeInput = {
  backend: "sqlite" | "postgres"; databaseUrl: string | undefined;
  documentRoot: string; referenceRoot: string; parserExecutable: string; ocrExecutable: string | null;
  parserScript?: string; ocrScript?: string;
};
export type RuntimeProbes = {
  storage: (root: string) => boolean;
  python: (executable: string, modules: string[]) => boolean;
  database: (url: string) => boolean;
  platform: string;
  script: (file: string) => boolean;
};
function childEnv(): NodeJS.ProcessEnv {
  return { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C.UTF-8" };
}
const production: RuntimeProbes = {
  platform: process.platform,
  script(file) {
    try {
      if (!fs.statSync(file).isFile()) return false;
      fs.accessSync(file, fs.constants.R_OK);
      return true;
    } catch { return false; }
  },
  storage(root) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) return false;
    let probe: string | undefined;
    try {
      const info = fs.lstatSync(root);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) return false;
      // Canonical roots avoid accidentally following a configured link elsewhere.
      if (fs.realpathSync(root) !== path.resolve(root)) return false;
      probe = fs.mkdtempSync(path.join(root, ".runtime-probe-"));
      fs.chmodSync(probe, 0o700);
      const file = path.join(probe, "write-test");
      fs.writeFileSync(file, "probe", { flag: "wx", mode: 0o600 });
      return fs.readFileSync(file, "utf8") === "probe";
    } catch { return false; }
    finally { if (probe) fs.rmSync(probe, { recursive: true, force: true }); }
  },
  python(executable, modules) {
    if (!executable) return false;
    const result = spawnSync(executable, ["-c", `import ${modules.join(", ")}`], {
      env: childEnv(), timeout: 15_000, maxBuffer: 1024, stdio: "ignore",
    });
    return result.status === 0 && !result.error;
  },
  database(value) {
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) return false;
      const env = childEnv();
      env.PGHOST = url.hostname;
      env.PGPORT = url.port || "5432";
      env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
      env.PGUSER = decodeURIComponent(url.username);
      env.PGPASSWORD = decodeURIComponent(url.password);
      env.PGCONNECT_TIMEOUT = "5";
      for (const [key, value] of url.searchParams) {
        if (key !== "sslmode") return false;
        env.PGSSLMODE = value;
      }
      const result = spawnSync("psql", ["-X", "--no-password", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", "SELECT 1"], {
        env, timeout: 10_000, maxBuffer: 1024, encoding: "utf8",
      });
      return result.status === 0 && result.stdout.trim() === "1";
    } catch { return false; }
  },
};
/** Startup/operator readiness probe: no credential values or subprocess text escape. */
export function validateRuntime(input: RuntimeInput, probes: RuntimeProbes = production): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.backend !== "sqlite" && input.backend !== "postgres") errors.push("backend_invalid");
  if (input.backend === "postgres") {
    if (!input.databaseUrl) errors.push("database_unconfigured");
    else if (!probes.database(input.databaseUrl)) errors.push("database_unreachable");
  }
  const docs = path.resolve(input.documentRoot), refs = path.resolve(input.referenceRoot);
  if (docs === refs || docs.startsWith(refs + path.sep) || refs.startsWith(docs + path.sep)) errors.push("storage_roots_overlap");
  if (!probes.storage(input.documentRoot)) errors.push("document_root_unsafe");
  if (!probes.storage(input.referenceRoot)) errors.push("reference_root_unsafe");
  const parserScript = input.parserScript ?? process.env.TARJETAS_PDF_SCRIPT ?? path.resolve(process.cwd(), "../scripts/pdf_to_json.py");
  const ocrScript = input.ocrScript ?? process.env.TARJETAS_OCR_SCRIPT ?? path.resolve(process.cwd(), "../scripts/ocr_receipt.py");
  if (!probes.script(parserScript)) errors.push("parser_script_unavailable");
  if (!probes.script(ocrScript)) errors.push("ocr_script_unavailable");
  if (!probes.python(input.parserExecutable, ["pdfplumber"])) errors.push("parser_unavailable");
  if (!input.ocrExecutable || probes.platform !== "darwin" || !probes.python(input.ocrExecutable, ["Vision", "Quartz", "Foundation"])) errors.push("ocr_unavailable");
  return { ok: errors.length === 0, errors };
}
