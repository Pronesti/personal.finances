import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export type Alias = { match: string; alias: string };

export function loadAliases(): Alias[] {
  const p = path.join(DATA_DIR, "merchant-aliases.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).aliases as Alias[];
}

// Prefix match, first match wins — same ordering convention as merchant-categories.json.
// Prefix (not substring) so "PEDIDOSYA PLUS" stays distinct from "PEDIDOSYA MCDONALDS FLO".
export function applyAlias(merchant: string, aliases: Alias[]): string {
  for (const a of aliases) if (merchant.startsWith(a.match)) return a.alias;
  return merchant;
}
