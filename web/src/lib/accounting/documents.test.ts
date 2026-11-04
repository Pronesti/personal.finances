import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createLocalDocuments, createMemoryDocuments } from "./documents";
let sandbox: string;
beforeEach(() => { sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "accounting-documents-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(sandbox, { recursive: true, force: true }); });
const bytes = Buffer.from("%PDF-synthetic-evidence");
const hash = createHash("sha256").update(bytes).digest("hex");

describe("private content-addressed documents", () => {
  it("atomically reuses identical content and reads exact bytes across adapter instances", async () => {
    const root = path.join(sandbox, "objects"), store = createLocalDocuments(root);
    const [first, second] = await Promise.all([store.put(bytes), store.put(Buffer.from(bytes))]);
    expect(first).toEqual(second);
    expect(first).toEqual({ sha256: hash, relativePath: hash });
    expect(await createLocalDocuments(root).read(first)).toEqual(bytes);
    expect(fs.readdirSync(root)).toEqual([hash]);
    expect(fs.statSync(root).mode & 0o077).toBe(0);
    expect(fs.statSync(path.join(root, hash)).mode & 0o077).toBe(0);
  });
  it("refuses corrupt existing objects rather than replacing them", async () => {
    const root = path.join(sandbox, "objects"), store = createLocalDocuments(root);
    const ref = await store.put(bytes);
    fs.writeFileSync(path.join(root, hash), "corrupt");
    await expect(store.put(bytes)).rejects.toThrow("document_hash_mismatch");
    await expect(store.read(ref)).rejects.toThrow("document_hash_mismatch");
    expect(fs.readFileSync(path.join(root, hash), "utf8")).toBe("corrupt");
    expect(fs.readdirSync(root)).toEqual([hash]);
  });
  it("rejects traversal, absolute paths and hash/path mismatches", async () => {
    const store = createLocalDocuments(path.join(sandbox, "objects"));
    for (const relativePath of ["../escape", path.join(sandbox, hash), `sub/${hash}`, `${hash}.pdf`, "b".repeat(64)]) {
      await expect(store.read({ sha256: hash, relativePath })).rejects.toThrow("invalid_document_reference");
    }
    expect(() => createLocalDocuments("relative")).toThrow("invalid_document_root");
    await expect(store.read({ sha256: hash, relativePath: hash })).rejects.toThrow("document_missing");
  });
  it("refuses symlink roots and hash objects without reading or writing their targets", async () => {
    const target = path.join(sandbox, "target");
    fs.mkdirSync(target, { mode: 0o700 });
    const linkedRoot = path.join(sandbox, "linked");
    fs.symlinkSync(target, linkedRoot);
    await expect(createLocalDocuments(linkedRoot).put(bytes)).rejects.toThrow("invalid_document_root");
    expect(fs.readdirSync(target)).toEqual([]);
    const root = path.join(sandbox, "objects"), store = createLocalDocuments(root);
    fs.mkdirSync(root, { mode: 0o700 });
    const outside = path.join(target, "outside");
    fs.writeFileSync(outside, bytes);
    fs.symlinkSync(outside, path.join(root, hash));
    await expect(store.put(bytes)).rejects.toThrow("invalid_document_object");
    await expect(store.read({ sha256: hash, relativePath: hash })).rejects.toThrow("invalid_document_object");
    expect(fs.readFileSync(outside)).toEqual(bytes);
  });
  it("rejects public roots and removes temporary objects when publication fails", async () => {
    const root = path.join(sandbox, "objects");
    fs.mkdirSync(root, { mode: 0o755 });
    fs.chmodSync(root, 0o755);
    await expect(createLocalDocuments(root).put(bytes)).rejects.toThrow("insecure_document_root");
    fs.chmodSync(root, 0o700);
    vi.spyOn(fs, "linkSync").mockImplementation(() => { throw new Error("simulated disk failure"); });
    await expect(createLocalDocuments(root).put(bytes)).rejects.toThrow("simulated disk failure");
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe("memory documents", () => {
  it("uses the real digest and owns source/read buffer copies", async () => {
    const store = createMemoryDocuments(), input = Buffer.from(bytes);
    const ref = await store.put(input);
    input.fill(0);
    const read = await store.read(ref);
    expect(ref).toEqual({ sha256: hash, relativePath: hash });
    expect(read).toEqual(bytes);
    read.fill(0);
    expect(await store.read(ref)).toEqual(bytes);
    expect(await store.put(Buffer.from(bytes))).toEqual(ref);
    await expect(store.read({ ...ref, relativePath: "../escape" })).rejects.toThrow("invalid_document_reference");
    await expect(store.read({ sha256: "b".repeat(64), relativePath: "b".repeat(64) })).rejects.toThrow("document_missing");
  });
});
