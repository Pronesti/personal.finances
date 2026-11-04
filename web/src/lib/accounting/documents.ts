import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AccountingError } from "./model";

export type DocumentRef = { sha256: string; relativePath: string };
export type DocumentStore = { put(bytes: Buffer): Promise<DocumentRef>; read(ref: DocumentRef): Promise<Buffer> };
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const refFor = (bytes: Buffer): DocumentRef => { const sha256 = digest(bytes); return { sha256, relativePath: sha256 }; };
function validateRef(ref: DocumentRef): void {
  if (!/^[a-f0-9]{64}$/.test(ref.sha256) || ref.relativePath !== ref.sha256) throw new AccountingError("invalid_document_reference");
}
function verify(bytes: Buffer, ref: DocumentRef): Buffer {
  if (digest(bytes) !== ref.sha256) throw new AccountingError("document_hash_mismatch");
  return bytes;
}

/** One configured private root, flat immutable hash objects, no caller-controlled file names. */
export function createLocalDocuments(root: string): DocumentStore {
  if (!path.isAbsolute(root)) throw new AccountingError("invalid_document_root");
  let canonicalRoot: string | null = null;
  const directory = (): string => {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new AccountingError("invalid_document_root");
    if ((stat.mode & 0o077) !== 0) throw new AccountingError("insecure_document_root");
    const resolved = fs.realpathSync(root);
    if (canonicalRoot !== null && canonicalRoot !== resolved) throw new AccountingError("document_root_changed");
    canonicalRoot = resolved;
    // Use the resolved root so a symlink in a parent never redirects object operations.
    const canonicalStat = fs.lstatSync(resolved);
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory()) throw new AccountingError("invalid_document_root");
    return resolved;
  };
  const readObject = (dir: string, ref: DocumentRef): Buffer => {
    validateRef(ref);
    let fd: number;
    try {
      const target = path.join(dir, ref.relativePath);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AccountingError("invalid_document_object");
      fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new AccountingError("document_missing");
      if (code === "ELOOP") throw new AccountingError("invalid_document_object");
      throw e;
    }
    try {
      if (!fs.fstatSync(fd).isFile()) throw new AccountingError("invalid_document_object");
      return verify(fs.readFileSync(fd), ref);
    } finally { fs.closeSync(fd); }
  };
  return {
    async put(bytes) {
      const ref = refFor(bytes), dir = directory();
      const temporary = path.join(dir, `.incoming-${randomUUID()}`);
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        try { fs.linkSync(temporary, path.join(dir, ref.relativePath)); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        // An existing object is never replaced. Verify its content, including concurrent puts.
        readObject(dir, ref);
        const directoryFd = fs.openSync(dir, fs.constants.O_RDONLY);
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
        return ref;
      } finally { fs.rmSync(temporary, { force: true }); }
    },
    async read(ref) { validateRef(ref); return readObject(directory(), ref); },
  };
}

/** Synthetic/rehearsal support obeys the same hash identity and owns its buffer copies. */
export function createMemoryDocuments(): DocumentStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(bytes) {
      const ref = refFor(bytes);
      if (!objects.has(ref.sha256)) objects.set(ref.sha256, Buffer.from(bytes));
      verify(objects.get(ref.sha256)!, ref);
      return ref;
    },
    async read(ref) {
      validateRef(ref);
      const bytes = objects.get(ref.sha256);
      if (!bytes) throw new AccountingError("document_missing");
      return Buffer.from(verify(bytes, ref));
    },
  };
}
