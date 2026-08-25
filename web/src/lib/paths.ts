import path from "node:path";

// Single knob for where the repo-level data/ dir lives relative to web/.
export const DATA_DIR = path.resolve(process.cwd(), "..", "data");
