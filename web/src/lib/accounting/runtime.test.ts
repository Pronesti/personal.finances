import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { validateRuntime, type RuntimeInput, type RuntimeProbes } from "./runtime";
const input: RuntimeInput = { backend: "postgres", databaseUrl: "postgresql://test@localhost/isolated", documentRoot: "/private/docs", referenceRoot: "/private/refs", parserExecutable: "/python", ocrExecutable: "/python" };
const probes = (): RuntimeProbes => ({ storage: vi.fn(() => true), python: vi.fn(() => true), database: vi.fn(() => true), platform: "darwin", script: vi.fn(() => true) });
it("requires explicit PG configuration", () => {
  const p = probes();
  expect(validateRuntime({ ...input, databaseUrl: undefined }, p).errors).toContain("database_unconfigured");
  expect(p.database).not.toHaveBeenCalled();
});
it("checks supplied executable, storage roots and connectivity", () => {
  const p = probes();
  expect(validateRuntime(input, p)).toEqual({ ok: true, errors: [] });
  expect(p.storage).toHaveBeenCalledWith(input.referenceRoot);
  expect(p.python).toHaveBeenCalledWith("/python", ["Vision", "Quartz", "Foundation"]);
  expect(p.database).toHaveBeenCalledWith(input.databaseUrl);
});
it("rejects unavailable dependencies, connection and overlapping storage", () => {
  const p = probes(); p.storage = () => false; p.database = () => false; p.python = () => false;
  expect(validateRuntime({ ...input, referenceRoot: input.documentRoot }, p).errors).toEqual(["database_unreachable", "storage_roots_overlap", "document_root_unsafe", "reference_root_unsafe", "parser_unavailable", "ocr_unavailable"]);
});
it("does not infer a working OCR engine on Linux or from a null executable", () => {
  expect(validateRuntime(input, { ...probes(), platform: "linux" }).errors).toContain("ocr_unavailable");
  expect(validateRuntime({ ...input, ocrExecutable: null }, probes()).errors).toContain("ocr_unavailable");
});
let temporary: string | undefined;
afterEach(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); temporary = undefined; });
it("production probes reject public, relative, linked and missing storage without credentials in results", () => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-test-")));
  const docs = path.join(temporary, "docs"), refs = path.join(temporary, "refs");
  fs.mkdirSync(docs, { mode: 0o755 }); fs.mkdirSync(refs, { mode: 0o700 });
  const result = validateRuntime({ ...input, backend: "sqlite", documentRoot: docs, referenceRoot: refs, parserExecutable: "/missing", ocrExecutable: null });
  expect(result.errors).toContain("document_root_unsafe");
  expect(result.errors).not.toContain("reference_root_unsafe");
  expect(fs.readdirSync(refs)).toEqual([]);
  fs.chmodSync(docs, 0o700);
  const link = path.join(temporary, "link"); fs.symlinkSync(docs, link);
  expect(validateRuntime({ ...input, backend: "sqlite", documentRoot: link, referenceRoot: "relative", parserExecutable: "/missing", ocrExecutable: null }).errors).toContain("document_root_unsafe");
});

it("checks configured parser and OCR script paths", () => {
  const p = probes(); p.script = vi.fn(() => false);
  const result = validateRuntime({ ...input, parserScript: "/configured/parser.py", ocrScript: "/configured/ocr.py" }, p);
  expect(result.errors).toContain("parser_script_unavailable");
  expect(result.errors).toContain("ocr_script_unavailable");
  expect(p.script).toHaveBeenCalledWith("/configured/ocr.py");
});
