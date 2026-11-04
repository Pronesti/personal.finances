import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { publishReferenceTable } from "./reference-publisher";
import { loadCpi } from "./cpi";
import { loadMep } from "./mep";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true }); });
function setup() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-publish-")); roots.push(root); vi.stubEnv("TARJETAS_REFERENCE_DIR", root); return root; }
it("keeps the old complete table visible until the new complete table is renamed", () => {
  const root = setup(), output = path.join(root, "ipc.json");
  fs.writeFileSync(output, JSON.stringify({ "2026-01": 100 }));
  const rename = fs.renameSync.bind(fs);
  const spy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    expect(path.dirname(String(source))).toBe(root);
    expect(loadCpi()).toEqual({ "2026-01": 100 });
    expect(JSON.parse(fs.readFileSync(source, "utf8"))).toEqual({ "2026-01": 105, "2026-02": 110 });
    rename(source, target);
  });
  expect(publishReferenceTable("ipc.json", { "2026-01": 105, "2026-02": 110 })).toBe(output);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(loadCpi()).toEqual({ "2026-01": 105, "2026-02": 110 });
  expect(fs.readdirSync(root)).toEqual(["ipc.json"]);
});
it("preserves prior MEP bytes and removes its staged file when rename fails", () => {
  const root = setup(), output = path.join(root, "mep.json"), old = '{"2026-01":1000}';
  fs.writeFileSync(output, old);
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("simulated_publish_failure"); });
  expect(() => publishReferenceTable("mep.json", { "2026-01": 1100 })).toThrow("simulated_publish_failure");
  expect(fs.readFileSync(output, "utf8")).toBe(old);
  expect(loadMep()).toEqual({ "2026-01": 1000 });
  expect(fs.readdirSync(root)).toEqual(["mep.json"]);
});
it("does not replace the prior table when staging fails", () => {
  const root = setup(), output = path.join(root, "ipc.json"); fs.writeFileSync(output, "{\"2026-01\":100}");
  vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw new Error("simulated_disk_failure"); });
  expect(() => publishReferenceTable("ipc.json", { "2026-01": 200 })).toThrow("simulated_disk_failure");
  expect(loadCpi()).toEqual({ "2026-01": 100 }); expect(fs.readdirSync(root)).toEqual(["ipc.json"]);
});
