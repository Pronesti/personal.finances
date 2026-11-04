import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DATA_DIR, referenceDir } from "./paths";
import { loadCpi } from "./cpi";
import { loadMep } from "./mep";

const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true });
});

it("keeps reference storage separate from the legacy database directory", () => {
  expect(referenceDir({})).toBe(DATA_DIR);
  expect(referenceDir({ TARJETAS_REFERENCE_DIR: "/private/tmp/references" })).toBe("/private/tmp/references");
  expect(DATA_DIR).toBe(path.resolve(process.cwd(), "..", "data"));
  expect(() => referenceDir({ TARJETAS_REFERENCE_DIR: "relative" })).toThrow("reference_root_must_be_absolute");
});

it("reads refreshed reference values without restarting or changing journal data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tarjetas-references-"));
  temporary.push(root);
  vi.stubEnv("TARJETAS_REFERENCE_DIR", root);
  fs.writeFileSync(path.join(root, "ipc.json"), JSON.stringify({ "2026-01": 100 }));
  fs.writeFileSync(path.join(root, "mep.json"), JSON.stringify({ "2026-01": 1000 }));
  expect(loadCpi()["2026-01"]).toBe(100);
  expect(loadMep()["2026-01"]).toBe(1000);
  fs.writeFileSync(path.join(root, "ipc.json"), JSON.stringify({ "2026-01": 105 }));
  fs.writeFileSync(path.join(root, "mep.json"), JSON.stringify({ "2026-01": 1100 }));
  expect(loadCpi()["2026-01"]).toBe(105);
  expect(loadMep()["2026-01"]).toBe(1100);
});
