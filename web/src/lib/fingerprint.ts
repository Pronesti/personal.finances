import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * What identifies one statement line across re-ingests: the card, the printed date, the printed
 * description, the amounts and the installment position. NOT merchant or category — aliases and
 * rules rewrite those, and a link to a charge must survive a recategorisation.
 */
export type ChargeIdentity = {
  brand: string; date: string | null; description: string; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

export function chargeKey(c: ChargeIdentity): string {
  return [c.brand, c.date ?? "", c.description, c.ars ?? "", c.usd ?? "", c.installment_number ?? "", c.installment_count ?? ""].join("|");
}

/** sha1 of the key plus an ordinal: the n-th identical line on a statement is its own charge. */
export function chargeFingerprint(c: ChargeIdentity, ordinal: number): string {
  return crypto.createHash("sha1").update(`${chargeKey(c)}#${ordinal}`).digest("hex");
}

/** Fingerprints for a statement's lines, in statement order. */
export function fingerprintAll(brand: string, txs: Omit<ChargeIdentity, "brand">[]): string[] {
  const seen = new Map<string, number>();
  return txs.map(t => {
    const c = { brand, ...t };
    const n = (seen.get(chargeKey(c)) ?? 0) + 1;
    seen.set(chargeKey(c), n);
    return chargeFingerprint(c, n);
  });
}

/**
 * Rows ingested before the column existed. Statement by statement, in insertion order (the
 * order of the JSON, which is the order of the statement), so ordinals come out as a fresh
 * ingest would compute them. Idempotent: only NULL rows are touched.
 */
export function backfillFingerprints(db: Database.Database): number {
  const statements = db.prepare(`
    SELECT DISTINCT s.id, s.brand FROM statements s JOIN transactions t ON t.statement_id = s.id
    WHERE t.fingerprint IS NULL`).all() as { id: number; brand: string }[];
  const rows = db.prepare(`
    SELECT id, date, description, ars, usd, installment_number, installment_count
    FROM transactions WHERE statement_id = ? ORDER BY id`);
  const update = db.prepare("UPDATE transactions SET fingerprint = ? WHERE id = ? AND fingerprint IS NULL");
  let changed = 0;
  db.transaction(() => {
    for (const s of statements) {
      const txs = rows.all(s.id) as ({ id: number } & Omit<ChargeIdentity, "brand">)[];
      fingerprintAll(s.brand, txs).forEach((fp, i) => { changed += update.run(fp, txs[i].id).changes; });
    }
  })();
  return changed;
}
