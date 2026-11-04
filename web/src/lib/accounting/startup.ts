import path from "node:path";
import { referenceDir } from "../paths";
import { validateRuntime } from "./runtime";

/** Explicit PostgreSQL readiness only: no migrations, SQLite access or implicit storage. */
export async function assertAccountingStartup(): Promise<void> {
  const backend = process.env.TARJETAS_BACKEND ?? "sqlite";
  if (backend === "sqlite") return;
  if (backend !== "postgres") throw new Error("backend_invalid");
  const documentRoot = process.env.TARJETAS_DOCUMENT_ROOT;
  const referenceRoot = process.env.TARJETAS_REFERENCE_DIR;
  if (!documentRoot || !path.isAbsolute(documentRoot)) throw new Error("document_root_unconfigured");
  if (!referenceRoot || !path.isAbsolute(referenceRoot)) throw new Error("reference_root_unconfigured");
  const { resolvePython, REPO_ROOT } = await import("../upload");
  let python: string;
  try { python = resolvePython(); } catch { throw new Error("parser_unavailable"); }
  const result = validateRuntime({
    backend: "postgres", databaseUrl: process.env.TARJETAS_DATABASE_URL,
    documentRoot, referenceRoot: referenceDir(), parserExecutable: python, ocrExecutable: python,
    parserScript: process.env.TARJETAS_PDF_SCRIPT ?? path.join(REPO_ROOT, "scripts", "pdf_to_json.py"),
    ocrScript: process.env.TARJETAS_OCR_SCRIPT ?? path.join(REPO_ROOT, "scripts", "ocr_receipt.py"),
  });
  if (!result.ok) throw new Error(`accounting_runtime_unavailable:${result.errors.join(",")}`);
}
