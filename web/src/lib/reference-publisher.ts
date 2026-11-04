import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { referenceDir } from "./paths";

/** Publish on the same filesystem so concurrent readers see the complete old or new table. */
export function publishReferenceTable(name: "ipc.json" | "mep.json", table: Record<string, number>, root = referenceDir()): string {
  const output = path.join(root, name);
  const payload = JSON.stringify(table, null, 1);
  const temporary = path.join(root, `.${name}.${randomUUID()}.tmp`);
  let owned = false;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    owned = true;
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, output);
    return output;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (owned) fs.rmSync(temporary, { force: true });
  }
}
