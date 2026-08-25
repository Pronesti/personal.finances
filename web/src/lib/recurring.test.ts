import { describe, it, expect } from "vitest";
import { detectRecurring } from "@/lib/recurring";

const ars = (merchant: string, month: string, amount: number, installment_count: number | null = null) =>
  ({ merchant, month, ars: amount, usd: null, installment_count });
const usd = (merchant: string, month: string, amount: number) =>
  ({ merchant, month, ars: null, usd: amount, installment_count: null });

describe("detectRecurring", () => {
  it("finds monthly ARS merchant and computes change", () => {
    const r = detectRecurring([ars("OSDE", "2026-04", 5000), ars("OSDE", "2026-05", 5000), ars("OSDE", "2026-06", 6000)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      merchant: "OSDE", currency: "ARS", occurrences: 3, lastMonth: "2026-06",
      lastAmount: 6000, prevAmount: 5000, nextExpectedMonth: "2026-07",
    });
    expect(r[0].pctChange).toBeCloseTo(20);
  });
  it("tracks USD-billed subscriptions separately per currency", () => {
    const rows = [
      ars("SPOTIFY", "2025-03", 4199), ars("SPOTIFY", "2025-04", 4199), ars("SPOTIFY", "2025-05", 4199),
      usd("SPOTIFY", "2025-06", 3.59), usd("SPOTIFY", "2025-07", 3.59), usd("SPOTIFY", "2025-08", 3.73),
    ];
    const r = detectRecurring(rows);
    const currencies = r.map(x => x.currency).sort();
    expect(currencies).toEqual(["ARS", "USD"]);
    expect(r.find(x => x.currency === "USD")!.lastAmount).toBeCloseTo(3.73);
  });
  it("ignores sparse (<60% of span) and <3-month merchants", () => {
    const sparse = [ars("A", "2026-01", 1), ars("A", "2026-04", 1), ars("A", "2026-07", 1)];
    const few = [ars("B", "2026-01", 1), ars("B", "2026-02", 1)];
    expect(detectRecurring([...sparse, ...few])).toHaveLength(0);
  });
  it("excludes cuota rows", () => {
    const rows = [ars("TIENDA", "2026-01", 100, 12), ars("TIENDA", "2026-02", 100, 12), ars("TIENDA", "2026-03", 100, 12)];
    expect(detectRecurring(rows)).toHaveLength(0);
  });
  it("sums same-merchant same-month rows", () => {
    const rows = [ars("OSDE", "2026-04", 100), ars("OSDE", "2026-04", 50), ars("OSDE", "2026-05", 150), ars("OSDE", "2026-06", 150)];
    const r = detectRecurring(rows);
    expect(r[0].lastAmount).toBe(150);
    expect(r[0].occurrences).toBe(3);
  });
});

describe("netting reversals", () => {
  it("nets an offsetting reversal instead of counting the charge twice", () => {
    const r = detectRecurring([
      ars("OSDE", "2026-04", 100), ars("OSDE", "2026-05", 100),
      ars("OSDE", "2026-06", 100), ars("OSDE", "2026-06", 100), ars("OSDE", "2026-06", -100),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].lastAmount).toBe(100);   // not 200
    expect(r[0].pctChange).toBe(0);
  });
  it("drops a month that nets to zero rather than treating it as an occurrence", () => {
    const r = detectRecurring([
      ars("GYM", "2026-01", 500), ars("GYM", "2026-02", 500), ars("GYM", "2026-03", 500),
      ars("GYM", "2026-04", 500), ars("GYM", "2026-04", -500),
    ]);
    expect(r[0].occurrences).toBe(3);
    expect(r[0].lastMonth).toBe("2026-03");
  });
});
