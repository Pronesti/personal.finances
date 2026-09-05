import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFile } from "@/lib/ingest";
import type { StatementJson } from "@/lib/integrity";
import type { Rule } from "@/lib/categorize";
import {
  MATCH_WINDOW_DAYS, amountMatches, candidateCharges, autoLink, linkReceipt, unlinkReceipt,
  receiptSide, reconciliation,
} from "@/lib/receipts/charges";

type Db = ReturnType<typeof openDb>;
const RULES: Rule[] = [{ match: "COTO", category: "food", subcategory: "supermarket" }, { match: "CAFE", category: "food", subcategory: "restaurant" }];

type Line = { date: string; description: string; ars: number; n?: number | null; of?: number | null };
function statement(brand: string, file: string, closing: string, lines: Line[]): StatementJson {
  return {
    file, brand,
    period: { closing_date: closing, due_date: closing, previous_closing_date: null },
    transactions: lines.map(l => ({
      section: "purchases", block: 1, date: l.date, description: l.description, ars: l.ars, usd: null,
      installment_number: l.n ?? null, installment_count: l.of ?? null,
    })),
  };
}
function receipt(db: Db, date: string, totalCents: number, fiscal = `2090-${date}${totalCents}`): number {
  return Number(db.prepare(
    `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
       header_json, verification_json, transcript_source, ocr_scale, created_at)
     VALUES ('coto', ?, ?, ?, '/x', ?, 0, ?, '{}', '{}', 'ocr', 3, 'now')`).run(date, fiscal, `sha-${fiscal}`, totalCents, totalCents).lastInsertRowid);
}
const links = (db: Db) => db.prepare("SELECT receipt_id, method FROM receipt_charge_links ORDER BY receipt_id").all();
const fpOf = (db: Db, description: string, ars: number) =>
  (db.prepare("SELECT fingerprint FROM transactions WHERE description = ? AND ars = ?").get(description, ars) as { fingerprint: string }).fingerprint;

describe("amountMatches", () => {
  it("accepts the exact total, or the installment times its count within a cent per installment", () => {
    expect(amountMatches(115370.8, null, 11537080)).toBe(true);
    expect(amountMatches(42144.25, 2, 8428850)).toBe(true);
    expect(amountMatches(42353.88, 3, 12706163)).toBe(true);   // 127061.63 / 3 rounded per installment
    expect(amountMatches(115370.81, null, 11537080)).toBe(false);
    expect(amountMatches(42144.25, null, 8428850)).toBe(false); // not an installment: half is not the total
    expect(amountMatches(42000, 3, 12706163)).toBe(false);
  });
});

describe("candidateCharges and autoLink", () => {
  it("links a same-day charge for the exact amount (the 2026-08-07 case)", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "visa_2026_08_29.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 },
      { date: "2026-08-09", description: "CAFE MARTINEZ", ars: 115370.8 }, // same amount, not a supermarket
    ]), RULES, []);
    const id = receipt(db, "2026-08-07", 11537080);
    expect(candidateCharges(db, { id, date: "2026-08-07", totalCents: 11537080 }).map(c => c.description)).toEqual(["MERPAGO*COTO"]);
    expect(autoLink(db)).toEqual({ linked: 1, pending: 0, unmatched: 0 });
    expect(links(db)).toEqual([{ receipt_id: id, method: "auto" }]);
  });

  it("links a charge paid in installments through its first installment only (the 2026-08-14 case)", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("mercadopago", "mp_2026_08_18.pdf", "2026-08-18", [
      { date: "2026-08-14", description: "MERPAGO*COTO", ars: 42144.25, n: 1, of: 2 },
    ]), RULES, []);
    ingestFile(db, statement("mercadopago", "mp_2026_09_18.pdf", "2026-09-18", [
      { date: "2026-08-14", description: "MERPAGO*COTO", ars: 42144.25, n: 2, of: 2 },
    ]), RULES, []);
    const id = receipt(db, "2026-08-14", 8428850);
    const c = candidateCharges(db, { id, date: "2026-08-14", totalCents: 8428850 });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ installment_number: 1, installment_count: 2, purchaseCents: 8428850, cycle_month: "2026-08" });
    expect(autoLink(db).linked).toBe(1);
  });

  it("uses a ±3 day window and leaves two candidates to the user", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-10", description: "MERPAGO*COTO", ars: 5000 },
      { date: "2026-08-04", description: "MERPAGO*COTO", ars: 5000 },   // 3 days before: in
      { date: "2026-08-11", description: "MERPAGO*COTO", ars: 7000 },   // 4 days after: out
    ]), RULES, []);
    const ambiguous = receipt(db, "2026-08-07", 500000);
    const late = receipt(db, "2026-08-07", 700000, "2090-late");
    expect(MATCH_WINDOW_DAYS).toBe(3);
    expect(candidateCharges(db, { id: ambiguous, date: "2026-08-07", totalCents: 500000 })).toHaveLength(2);
    expect(candidateCharges(db, { id: late, date: "2026-08-07", totalCents: 700000 })).toHaveLength(0);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 1, unmatched: 1 });
    expect(links(db)).toEqual([]);
  });

  it("never offers a charge that is already linked to another receipt", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 5000 }]), RULES, []);
    const first = receipt(db, "2026-08-07", 500000, "a");
    const second = receipt(db, "2026-08-08", 500000, "b");
    autoLink(db); // first gets it? No: both receipts see one candidate → ambiguity is per charge too.
    expect(links(db)).toEqual([]);
    linkReceipt(db, first, fpOf(db, "MERPAGO*COTO", 5000));
    expect(candidateCharges(db, { id: second, date: "2026-08-08", totalCents: 500000 })).toEqual([]);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 0, unmatched: 1 });
  });

  it("does not link a receipt twice, and survives a re-ingest of the statement", () => {
    const db = openDb(":memory:");
    const s = statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 }]);
    ingestFile(db, s, RULES, []);
    receipt(db, "2026-08-07", 11537080);
    autoLink(db);
    expect(autoLink(db)).toEqual({ linked: 0, pending: 0, unmatched: 0 });
    ingestFile(db, s, RULES, []); // rows deleted and re-inserted; the fingerprint is the same
    const fp = (db.prepare("SELECT fingerprint FROM receipt_charge_links").get() as { fingerprint: string }).fingerprint;
    expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE fingerprint = ?").get(fp)).toEqual({ n: 1 });
  });
});

describe("linkReceipt / unlinkReceipt", () => {
  it("links by hand, replaces a previous link of the same receipt, and refuses a taken charge", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 5000 },
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 6000 },
    ]), RULES, []);
    const a = receipt(db, "2026-08-07", 500000, "a");
    const b = receipt(db, "2026-08-07", 600000, "b");
    const fp5 = fpOf(db, "MERPAGO*COTO", 5000), fp6 = fpOf(db, "MERPAGO*COTO", 6000);
    linkReceipt(db, a, fp6);            // the user knows better than the amount
    expect(links(db)).toEqual([{ receipt_id: a, method: "manual" }]);
    linkReceipt(db, a, fp5);            // re-link: the old link goes
    expect(db.prepare("SELECT fingerprint FROM receipt_charge_links WHERE receipt_id = ?").get(a)).toEqual({ fingerprint: fp5 });
    expect(() => linkReceipt(db, b, fp5)).toThrow(/already linked/);
    expect(() => linkReceipt(db, b, "0".repeat(40))).toThrow(/no charge/);
    expect(() => linkReceipt(db, 999, fp6)).toThrow(/no receipt/);
    unlinkReceipt(db, a);
    expect(links(db)).toEqual([]);
    unlinkReceipt(db, a); // no-op
  });
});

describe("hooks", () => {
  it("links a receipt when the statement that pays it arrives later", () => {
    const db = openDb(":memory:");
    receipt(db, "2026-08-07", 11537080);
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [{ date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 }]), RULES, []);
    expect(links(db)).toEqual([{ receipt_id: 1, method: "auto" }]);
  });
});

describe("reconciliation reads", () => {
  function world() {
    const db = openDb(":memory:");
    ingestFile(db, statement("visa", "v.pdf", "2026-08-29", [
      { date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8 },          // matched
      { date: "2026-08-21", description: "COTO SUCURSAL 90", ars: 6666.5, n: 1, of: 3 }, // no receipt → unmatched charge
      { date: "2026-08-10", description: "MERPAGO*COTO", ars: 5000 },              // two candidates for one receipt
      { date: "2026-08-09", description: "MERPAGO*COTO", ars: 5000 },
    ]), RULES, []);
    receipt(db, "2026-08-07", 11537080, "m");
    receipt(db, "2026-08-08", 500000, "p");   // pending: two candidates
    receipt(db, "2026-08-28", 12188854, "u"); // unmatched: no charge yet
    autoLink(db);
    return db;
  }

  it("describes one receipt: its charge, or its candidates", () => {
    const db = world();
    expect(receiptSide(db, 1)).toMatchObject({
      id: 1, date: "2026-08-07", totalCents: 11537080, state: "matched", method: "auto",
      charge: { description: "MERPAGO*COTO", ars: 115370.8, brand: "visa", purchaseCents: 11537080, cycle_month: "2026-08" },
      candidates: [],
    });
    const pending = receiptSide(db, 2)!;
    expect(pending.state).toBe("pending");
    expect(pending.charge).toBeNull();
    expect(pending.candidates.map(c => c.date)).toEqual(["2026-08-09", "2026-08-10"]);
    expect(receiptSide(db, 3)).toMatchObject({ state: "unmatched", charge: null, candidates: [] });
    expect(receiptSide(db, 99)).toBeNull();
  });

  it("lists both sides with a summary", () => {
    const r = reconciliation(world());
    expect(r.receipts.map(x => x.state)).toEqual(["unmatched", "pending", "matched"]); // newest first
    expect(r.charges.map(c => [c.date, c.receiptId])).toEqual([
      ["2026-08-21", null], ["2026-08-10", null], ["2026-08-09", null], ["2026-08-07", 1],
    ]);
    expect(r.charges[0].purchaseCents).toBe(1999950); // 6666.5 × 3
    expect(r.summary).toEqual({
      chargedCents: 11537080 + 1999950 + 500000 + 500000,
      analyzedCents: 11537080 + 500000 + 12188854,
      matchedCents: 11537080,
      unmatchedCharges: 3, pendingReceipts: 1, unmatchedReceipts: 1,
    });
  });
});
