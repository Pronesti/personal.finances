import { describe, it, expect } from "vitest";
import { detectAnomalies } from "@/lib/anomalies";

const cpi = { "2026-01": 100, "2026-02": 105, "2026-03": 110, "2026-04": 115 };

type RowOpts = Partial<{
  statement_id: number; merchant: string; month: string; date: string;
  ars: number | null; usd: number | null; installment_count: number | null;
}>;

// date defaults to the 10th of the row's own month so month and date never disagree.
const row = (o: RowOpts = {}) => {
  const month = o.month ?? "2026-04";
  return {
    statement_id: o.statement_id ?? 1,
    merchant: o.merchant ?? "X",
    month,
    date: o.date ?? `${month}-10`,
    ars: o.ars === undefined ? 50000 : o.ars,
    usd: o.usd ?? null,
    installment_count: o.installment_count ?? null,
  };
};

const only = (kind: string, rows: ReturnType<typeof row>[]) =>
  detectAnomalies(rows, cpi).filter(a => a.kind === kind);

describe("duplicate detection", () => {
  it("flags same merchant + amount within 2 days on one statement", () => {
    const out = only("duplicate", [
      row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }),
      row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "OSDE", resolved: false, amount: 273395.99 });
  });

  it("marks a duplicate resolved when the statement carries an exact reversal", () => {
    const out = only("duplicate", [
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: 57613.51 }),
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: 57613.51 }),
      row({ merchant: "PERSONAL", date: "2026-04-24", ars: -57613.51 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].resolved).toBe(true);
    expect(out[0].message).toMatch(/reversed/);
  });

  it("never pairs rows from different statements — two cards, one cinema trip", () => {
    expect(only("duplicate", [
      row({ statement_id: 32, merchant: "HOYTS", date: "2026-04-15", ars: 32800 }),
      row({ statement_id: 48, merchant: "HOYTS", date: "2026-04-15", ars: 32800 }),
    ])).toHaveLength(0);
  });

  it("never flags installment rows — the same purchase is re-listed every statement", () => {
    expect(only("duplicate", ["2026-01", "2026-02", "2026-03", "2026-04"].map(month =>
      row({ merchant: "TIENDANEWSAN", month, date: "2025-07-17", ars: 166666.61, installment_count: 18 })
    ))).toHaveLength(0);
  });

  it("ignores small repeats below the amount floor (PedidosYa tips)", () => {
    expect(only("duplicate", [
      row({ merchant: "PEDIDOSYA PROPINA", date: "2026-04-10", ars: 550 }),
      row({ merchant: "PEDIDOSYA PROPINA", date: "2026-04-11", ars: 550 }),
    ])).toHaveLength(0);
  });

  it("ignores identical charges more than 2 days apart", () => {
    expect(only("duplicate", [
      row({ merchant: "OSDE", date: "2026-04-01", ars: 273395.99 }),
      row({ merchant: "OSDE", date: "2026-04-10", ars: 273395.99 }),
    ])).toHaveLength(0);
  });

  it("pairs each row at most once — three identical charges report one pair", () => {
    expect(only("duplicate",
      [1, 2, 3].map(() => row({ merchant: "OSDE", date: "2026-04-24", ars: 273395.99 }))
    )).toHaveLength(1);
  });
});

describe("amount-jump detection", () => {
  const monthly = (month: string, ars: number) => row({ merchant: "OSDE", month, date: `${month}-05`, ars });

  it("stays silent when a recurring charge merely tracks inflation", () => {
    // +5%/month nominal against +5%/month CPI = flat in real terms.
    expect(only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 105000),
      monthly("2026-03", 110000), monthly("2026-04", 115000),
    ])).toHaveLength(0);
  });

  it("flags a real-terms price hike on a recurring merchant", () => {
    const out = only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 105000),
      monthly("2026-03", 110000), monthly("2026-04", 180000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "OSDE", month: "2026-04" });
    expect(out[0].message).toMatch(/real terms/);
  });

  it("ignores merchants billed many times a month — that is volume, not price", () => {
    // A supermarket: 1 charge a month, then 4 in April. The monthly total quadruples; price did not.
    expect(only("amount_jump", [
      monthly("2026-01", 100000), monthly("2026-02", 100000), monthly("2026-03", 100000),
      monthly("2026-04", 100000), monthly("2026-04", 100000),
      monthly("2026-04", 100000), monthly("2026-04", 100000),
    ])).toHaveLength(0);
  });

  it("never flags a non-recurring merchant, however wild the amounts", () => {
    expect(only("amount_jump", [
      row({ merchant: "ONE OFF", month: "2026-01", ars: 1000 }),
      row({ merchant: "ONE OFF", month: "2026-04", ars: 900000 }),
    ])).toHaveLength(0);
  });
});

describe("new-merchant detection", () => {
  it("flags merchants first seen in the latest month, above the floor, once each", () => {
    const out = only("new_merchant", [
      row({ merchant: "OSDE", month: "2026-01", ars: 100000 }),
      row({ merchant: "OSDE", month: "2026-04", ars: 100000 }),
      row({ merchant: "SOCIAL CORAZON", month: "2026-04", ars: 60000 }),
      row({ merchant: "SOCIAL CORAZON", month: "2026-04", ars: 55700 }),
      row({ merchant: "TINY", month: "2026-04", ars: 300 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ merchant: "SOCIAL CORAZON", amount: 115700 });
  });

  it("returns nothing at all on an empty history", () => {
    expect(detectAnomalies([], cpi)).toEqual([]);
  });
});
