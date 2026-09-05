import type Database from "better-sqlite3";

export type LinkMethod = "auto" | "manual";
export type ChargeRef = {
  fingerprint: string; brand: string; date: string | null; description: string; merchant: string; ars: number;
  installment_number: number | null; installment_count: number | null; cycle_month: string; statement_file: string;
  /** The whole purchase: one installment times the count. What a receipt total compares against. */
  purchaseCents: number;
};
export type AutoLinkReport = { linked: number; pending: number; unmatched: number };

/** Card charges post late; three days covers every case seen and keeps a weekly shop from matching the next one. */
export const MATCH_WINDOW_DAYS = 3;

/**
 * Exact total, or one installment times its count. The bank computes each installment by
 * rounding the true share to the cent and gives the leftover remainder to the first one, so the
 * first installment can be up to (n − 1) cents away from an even n-way split; multiplied back out
 * by n, that first-installment deviation is amplified to as much as n·(n − 1) cents.
 */
export function amountMatches(ars: number, installmentCount: number | null, totalCents: number): boolean {
  const cents = Math.round(ars * 100);
  if (installmentCount === null || installmentCount <= 1) return cents === totalCents;
  return Math.abs(cents * installmentCount - totalCents) <= installmentCount * (installmentCount - 1);
}

// A supermarket purchase, first installment only, not yet linked. The date window is SQL; the
// amount test is JS because it depends on the installment count.
const CANDIDATE_SQL = `
  SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
         s.cycle_month, s.file AS statement_file
  FROM transactions t JOIN statements s ON s.id = t.statement_id
  WHERE t.section = 'purchases' AND t.category = 'food' AND t.subcategory = 'supermarket'
    AND t.ars IS NOT NULL AND t.ars > 0 AND t.date IS NOT NULL AND t.fingerprint IS NOT NULL
    AND (t.installment_number IS NULL OR t.installment_number = 1)
    AND t.date BETWEEN date(?, ?) AND date(?, ?)
    AND t.fingerprint NOT IN (SELECT fingerprint FROM receipt_charge_links)
  ORDER BY t.date, t.id`;

type ChargeRow = Omit<ChargeRef, "purchaseCents">;
const withPurchase = (r: ChargeRow): ChargeRef => ({
  ...r, purchaseCents: Math.round(r.ars * 100) * (r.installment_count && r.installment_count > 1 ? r.installment_count : 1),
});

export function candidateCharges(
  db: Database.Database, receipt: { id: number; date: string; totalCents: number },
): ChargeRef[] {
  const rows = db.prepare(CANDIDATE_SQL)
    .all(receipt.date, `-${MATCH_WINDOW_DAYS} days`, receipt.date, `+${MATCH_WINDOW_DAYS} days`) as ChargeRow[];
  return rows.filter(r => amountMatches(r.ars, r.installment_count, receipt.totalCents)).map(withPurchase);
}

/**
 * Every receipt without a link: exactly one candidate → linked (auto); several → left for the
 * user (pending); none → unmatched. A charge that is the single candidate of two receipts is
 * linked to neither: ambiguity on either side is the user's call. Runs after a receipt is
 * stored and after a statement is ingested; cheap, because linked receipts are skipped.
 */
export function autoLink(db: Database.Database): AutoLinkReport {
  const open = db.prepare(`
    SELECT r.id, r.date, r.total_cents AS totalCents FROM receipts r
    WHERE r.id NOT IN (SELECT receipt_id FROM receipt_charge_links) ORDER BY r.date, r.id`)
    .all() as { id: number; date: string; totalCents: number }[];
  const report: AutoLinkReport = { linked: 0, pending: 0, unmatched: 0 };
  const proposals = new Map<string, number[]>(); // fingerprint → receipts it is the single candidate of
  const single: { id: number; fingerprint: string }[] = [];
  for (const r of open) {
    const c = candidateCharges(db, r);
    if (c.length === 0) report.unmatched++;
    else if (c.length > 1) report.pending++;
    else { single.push({ id: r.id, fingerprint: c[0].fingerprint }); proposals.set(c[0].fingerprint, [...(proposals.get(c[0].fingerprint) ?? []), r.id]); }
  }
  db.transaction(() => {
    for (const s of single) {
      if ((proposals.get(s.fingerprint) ?? []).length > 1) { report.pending++; continue; }
      insertLink(db, s.id, s.fingerprint, "auto");
      report.linked++;
    }
  })();
  return report;
}

function insertLink(db: Database.Database, receiptId: number, fingerprint: string, method: LinkMethod): void {
  db.prepare("INSERT INTO receipt_charge_links (receipt_id, fingerprint, method, created_at) VALUES (?, ?, ?, ?)")
    .run(receiptId, fingerprint, method, new Date().toISOString());
}

/** The user's decision. Replaces this receipt's previous link; refuses a charge another receipt holds. */
export function linkReceipt(db: Database.Database, receiptId: number, fingerprint: string, method: LinkMethod = "manual"): void {
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM receipts WHERE id = ?").get(receiptId)) throw new Error(`no receipt ${receiptId}`);
    if (!db.prepare("SELECT 1 FROM transactions WHERE fingerprint = ?").get(fingerprint)) throw new Error(`no charge ${fingerprint}`);
    const holder = db.prepare("SELECT receipt_id FROM receipt_charge_links WHERE fingerprint = ?").get(fingerprint) as { receipt_id: number } | undefined;
    if (holder && holder.receipt_id !== receiptId) throw new Error(`charge already linked to receipt ${holder.receipt_id}`);
    db.prepare("DELETE FROM receipt_charge_links WHERE receipt_id = ?").run(receiptId);
    insertLink(db, receiptId, fingerprint, method);
  })();
}

export function unlinkReceipt(db: Database.Database, receiptId: number): void {
  db.prepare("DELETE FROM receipt_charge_links WHERE receipt_id = ?").run(receiptId);
}

export type ReceiptSide = {
  id: number; date: string; totalCents: number;
  state: "matched" | "pending" | "unmatched";
  charge: ChargeRef | null; method: LinkMethod | null; candidates: ChargeRef[];
};
export type ChargeSide = ChargeRef & { receiptId: number | null; receiptDate: string | null; method: LinkMethod | null };
export type Reconciliation = {
  receipts: ReceiptSide[];
  charges: ChargeSide[];
  summary: {
    chargedCents: number; analyzedCents: number; matchedCents: number;
    unmatchedCharges: number; pendingReceipts: number; unmatchedReceipts: number;
  };
};

const LINKED_CHARGE_SQL = `
  SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
         s.cycle_month, s.file AS statement_file, l.method
  FROM receipt_charge_links l
  JOIN transactions t ON t.fingerprint = l.fingerprint
  JOIN statements s ON s.id = t.statement_id
  WHERE l.receipt_id = ?
  ORDER BY t.installment_number LIMIT 1`;

/** One receipt's side of the ledger: the charge it is linked to, or what it could be linked to. */
export function receiptSide(db: Database.Database, receiptId: number): ReceiptSide | null {
  const r = db.prepare("SELECT id, date, total_cents AS totalCents FROM receipts WHERE id = ?").get(receiptId) as
    { id: number; date: string; totalCents: number } | undefined;
  if (!r) return null;
  const linked = db.prepare(LINKED_CHARGE_SQL).get(receiptId) as (ChargeRow & { method: LinkMethod }) | undefined;
  if (linked) {
    const { method, ...charge } = linked;
    return { ...r, state: "matched", charge: withPurchase(charge), method, candidates: [] };
  }
  const candidates = candidateCharges(db, r);
  return { ...r, state: candidates.length > 1 ? "pending" : "unmatched", charge: null, method: null, candidates };
}

/**
 * Both sides, newest first. The charge side is every supermarket purchase (first installments
 * only), linked or not: the unlinked ones are shopping trips with no receipt uploaded — the
 * completeness check receipts alone cannot give.
 */
export function reconciliation(db: Database.Database): Reconciliation {
  const receiptIds = (db.prepare("SELECT id FROM receipts ORDER BY date DESC, time DESC, id DESC").all() as { id: number }[]).map(x => x.id);
  const receipts = receiptIds.map(id => receiptSide(db, id)!);
  const chargeRows = db.prepare(`
    SELECT t.fingerprint, s.brand, t.date, t.description, t.merchant, t.ars, t.installment_number, t.installment_count,
           s.cycle_month, s.file AS statement_file, l.receipt_id AS receiptId, r.date AS receiptDate, l.method
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    LEFT JOIN receipt_charge_links l ON l.fingerprint = t.fingerprint
    LEFT JOIN receipts r ON r.id = l.receipt_id
    WHERE t.section = 'purchases' AND t.category = 'food' AND t.subcategory = 'supermarket'
      AND t.ars IS NOT NULL AND t.ars > 0 AND t.fingerprint IS NOT NULL
      AND (t.installment_number IS NULL OR t.installment_number = 1)
    ORDER BY t.date DESC, t.id DESC`).all() as (ChargeRow & { receiptId: number | null; receiptDate: string | null; method: LinkMethod | null })[];
  const charges: ChargeSide[] = chargeRows.map(c => ({ ...withPurchase(c), receiptId: c.receiptId, receiptDate: c.receiptDate, method: c.method }));
  return {
    receipts, charges,
    summary: {
      chargedCents: charges.reduce((s, c) => s + c.purchaseCents, 0),
      analyzedCents: receipts.reduce((s, r) => s + r.totalCents, 0),
      matchedCents: charges.filter(c => c.receiptId !== null).reduce((s, c) => s + c.purchaseCents, 0),
      unmatchedCharges: charges.filter(c => c.receiptId === null).length,
      pendingReceipts: receipts.filter(r => r.state === "pending").length,
      unmatchedReceipts: receipts.filter(r => r.state === "unmatched").length,
    },
  };
}
