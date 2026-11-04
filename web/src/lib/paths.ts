import path from "node:path";

// Single knob for where the repo-level data/ dir lives relative to web/.
export const DATA_DIR = path.resolve(process.cwd(), "..", "data");

/** Public valuation series have their own persistent root; never relocates SQLite. */
export function referenceDir(env: Record<string, string | undefined> = process.env): string {
  const root = env.TARJETAS_REFERENCE_DIR;
  if (root === undefined) return DATA_DIR;
  if (!root || !path.isAbsolute(root)) throw new Error("reference_root_must_be_absolute");
  return path.resolve(root);
}
