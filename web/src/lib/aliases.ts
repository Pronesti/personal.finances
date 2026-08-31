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

// Follows an alias to the name it finally settles on. applyAlias returns on the first match and
// deliberately does not iterate — a chain there would make a row's merchant depend on how many
// times the aliases were applied — so the walking happens here instead, on the storing side: a
// target is resolved once, when it is written, and the table itself never comes to hold a chain.
// `seen` is the cycle guard. A list that already holds A -> B and B -> A can only be reached by
// editing the database by hand, and this walks such a list to a stop rather than hanging on it.
export function resolveAlias(name: string, aliases: Alias[]): string {
  let out = name;
  const seen = new Set([out]);
  for (;;) {
    const next = applyAlias(out, aliases);
    if (next === out || seen.has(next)) return out;
    seen.add(next);
    out = next;
  }
}

/**
 * Merges every merchant whose normalized name starts with `from` into the single name `to`, and
 * returns the new alias list. This is the pure half of a merge: the caller stores the result with
 * saveAliases and then rebuilds the rows already loaded with realias().
 *
 * Three things have to be true of the result, and each is one line below.
 *
 * - The new entry has to beat the entries it shadows and lose to the ones that are more specific.
 *   Position is priority here — first match wins — so it goes first, the same reasoning as
 *   upsertRule, EXCEPT past the entries whose match extends this one. Merging "PEDIDOSYA" at
 *   position 0 would swallow "PEDIDOSYA PLUS", which is the very split those entries exist to
 *   keep. It still goes ahead of any entry that is a proper prefix of it, which is what makes a
 *   later, narrower merge win over an earlier, broader one.
 * - `to` has to be a name nothing else aliases away, or the merge splits the merchants it was
 *   for: the rows reaching it directly would go on to a third name while these stop here.
 * - Every other entry that fed the old name has to follow it, so a merchant reached through an
 *   older alias moves too — merging HBO MAX renames the rows that only ever said HELP HBOM. That
 *   is the final pass, and it is one pass rather than a loop to a fixed point: resolveAlias has
 *   already made every target settle under the matches, and rewriting targets never changes
 *   which entry claims a given name.
 */
export function mergeAlias(aliases: Alias[], from: string, to: string): Alias[] {
  const match = from.trim().toUpperCase();
  // Rewriting the entry for a match is the point here, never something to refuse — the match is
  // UNIQUE in the table, and a second merge of the same name is a correction of the first.
  const others = aliases.filter(a => a.match !== match);
  // Resolved against `others` rather than the whole list, because the entry being replaced is
  // about to stop meaning what it means. Renaming CARREFOUR to CARREFOUR EXPRESS reads its own
  // outgoing entry otherwise, decides the new name already resolves to CARREFOUR, and quietly
  // undoes the rename it was asked for.
  const target = resolveAlias(to.trim().toUpperCase(), others);
  // Same 3-character floor as a category rule, for a stronger reason: this one matches on a
  // PREFIX rather than a substring, so "MC" would rename most of the alphabet's M aisle at once.
  if (match.length < 3 || target.length === 0) return aliases;
  const lastMoreSpecific = others.findLastIndex(a => a.match.startsWith(match));
  const firstLessSpecific = others.findIndex(a => match.startsWith(a.match));
  let at = lastMoreSpecific + 1;
  if (firstLessSpecific !== -1 && firstLessSpecific < at) at = firstLessSpecific;
  const merged = [...others.slice(0, at), { match, alias: target }, ...others.slice(at)];
  return merged.map(a => ({ match: a.match, alias: resolveAlias(a.alias, merged) }));
}
