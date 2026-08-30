import fs from "node:fs";
import type Database from "better-sqlite3";

export type Alias = { match: string; alias: string };

// Ordered by the explicit position column for the same reason the rules are: prefix match, first
// match wins, so "PEDIDOSYA PLUS" has to be tried before anything that starts with "PEDIDOSYA".
export function loadAliases(db: Database.Database): Alias[] {
  return db.prepare("SELECT match, alias FROM merchant_aliases ORDER BY position").all() as Alias[];
}

export function saveAliases(db: Database.Database, aliases: Alias[]): void {
  db.transaction(() => {
    db.exec("DELETE FROM merchant_aliases");
    const ins = db.prepare("INSERT INTO merchant_aliases (position, match, alias) VALUES (?, ?, ?)");
    aliases.forEach((a, i) => ins.run(i, a.match, a.alias));
  })();
}

// Seeds a fresh database from data/merchant-aliases.json, in file order. Same guard and same
// lifetime as seedCategoryData: empty table plus an existing file, both of which go when the
// file does.
export function seedAliases(db: Database.Database, file: string): void {
  const { n } = db.prepare("SELECT COUNT(*) n FROM merchant_aliases").get() as { n: number };
  if (n > 0 || !fs.existsSync(file)) return;
  saveAliases(db, (JSON.parse(fs.readFileSync(file, "utf8")) as { aliases?: Alias[] }).aliases ?? []);
}

// Prefix match, first match wins — same ordering convention as the category rules.
// Prefix (not substring) so "PEDIDOSYA PLUS" stays distinct from "PEDIDOSYA MCDONALDS FLO".
export function applyAlias(merchant: string, aliases: Alias[]): string {
  for (const a of aliases) if (merchant.startsWith(a.match)) return a.alias;
  return merchant;
}
