import { describe, it, expect } from "vitest";
import { detectRecurring } from "@/lib/recurring";

const ars = (merchant: string, month: string, amount: number, installment_count: number | null = null) =>
  ({ merchant, month, ars: amount, usd: null, installment_count });
const usd = (merchant: string, month: string, amount: number) =>
  ({ merchant, month, ars: null, usd: amount, installment_count: null });

// Four consecutive months of the same amount: the minimum a charge must clear to be detected.
const steady = (merchant: string, from: string[], amounts: number[]) =>
  from.map((m, i) => ars(merchant, m, amounts[i]));

describe("detectRecurring", () => {
  it("finds monthly ARS merchant and computes change", () => {
    const r = detectRecurring([
      ars("OSDE", "2026-04", 5000), ars("OSDE", "2026-05", 5000),
      ars("OSDE", "2026-06", 5000), ars("OSDE", "2026-07", 6000),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      merchant: "OSDE", currency: "ARS", currencies: ["ARS"], occurrences: 4,
      firstMonth: "2026-04", lastMonth: "2026-07",
      lastAmount: 6000, prevAmount: 5000, nextExpectedMonth: "2026-08",
      status: "active", confidence: "high", monthsSinceLast: 0,
    });
    expect(r[0].pctChange).toBeCloseTo(20);
  });

  it("ignores sparse (<60% of span) and <4-month merchants", () => {
    const sparse = [ars("A", "2026-01", 1), ars("A", "2026-04", 1), ars("A", "2026-07", 1), ars("A", "2026-10", 1)];
    const few = [ars("B", "2026-01", 1), ars("B", "2026-02", 1), ars("B", "2026-03", 1)];
    expect(detectRecurring([...sparse, ...few])).toHaveLength(0);
  });

  it("excludes installment rows", () => {
    const rows = ["2026-01", "2026-02", "2026-03", "2026-04"].map(m => ars("TIENDA", m, 100, 12));
    expect(detectRecurring(rows)).toHaveLength(0);
  });

  it("sums same-merchant same-month rows", () => {
    const rows = [
      ars("OSDE", "2026-04", 100), ars("OSDE", "2026-04", 50),
      ars("OSDE", "2026-05", 150), ars("OSDE", "2026-06", 150), ars("OSDE", "2026-07", 150),
    ];
    const r = detectRecurring(rows);
    expect(r[0].lastAmount).toBe(150);
    expect(r[0].occurrences).toBe(4);
  });
});

describe("currency migration", () => {
  // Real case: Spotify and YouTube Premium moved from ARS to USD billing in 2025-06 with no gap.
  // Keyed by merchant+currency this produced two rows, one of which looked like a cancellation.
  const migrated = [
    ars("SPOTIFY", "2025-02", 4199), ars("SPOTIFY", "2025-03", 4199),
    ars("SPOTIFY", "2025-04", 4199), ars("SPOTIFY", "2025-05", 4199),
    usd("SPOTIFY", "2025-06", 3.59), usd("SPOTIFY", "2025-07", 3.59),
    usd("SPOTIFY", "2025-08", 3.73), usd("SPOTIFY", "2025-09", 3.73),
  ];

  it("reports a migrated merchant as one active row, not a dead one plus a live one", () => {
    const r = detectRecurring(migrated);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      merchant: "SPOTIFY", currency: "USD", currencies: ["ARS", "USD"],
      occurrences: 8, status: "active", lastMonth: "2025-09",
    });
    expect(r[0].lastAmount).toBeCloseTo(3.73);
  });

  it("suppresses pctChange across the currency switch rather than dividing ARS by USD", () => {
    const r = detectRecurring(migrated.slice(0, 5));
    expect(r[0].lastMonth).toBe("2025-06");
    expect(r[0].prevAmount).toBeNull();
    expect(r[0].pctChange).toBeNull();
  });
});

describe("lapsed charges", () => {
  const adobe = steady("ADOBE", ["2026-01", "2026-02", "2026-03", "2026-04"], [8794, 8794, 8794, 8794]);

  it("keeps a charge active while it is at most one cycle behind the newest month", () => {
    const r = detectRecurring(adobe, { latestMonth: "2026-05" });
    expect(r[0]).toMatchObject({ status: "active", monthsSinceLast: 1, nextExpectedMonth: "2026-05" });
  });

  it("marks a charge lapsed after two missed cycles and stops forecasting a next charge", () => {
    const r = detectRecurring(adobe, { latestMonth: "2026-08" });
    expect(r[0]).toMatchObject({ status: "lapsed", monthsSinceLast: 4, nextExpectedMonth: null });
  });

  it("still reports a lapsed charge as having been regular — density is not a recency test", () => {
    const r = detectRecurring(adobe, { latestMonth: "2027-06" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ occurrences: 4, status: "lapsed", confidence: "high" });
  });

  it("defaults the newest month to the newest month in the rows", () => {
    const r = detectRecurring([...adobe, ars("HBO", "2026-08", 100)]);
    expect(r.find(x => x.merchant === "ADOBE")!.monthsSinceLast).toBe(4);
  });

  it("sorts active before lapsed", () => {
    const live = steady("HBO", ["2026-05", "2026-06", "2026-07", "2026-08"], [100, 100, 100, 100]);
    const r = detectRecurring([...adobe, ...live]);
    expect(r.map(x => x.merchant)).toEqual(["HBO", "ADOBE"]);
  });
});

describe("price regimes", () => {
  // 5%/month for a year — fast enough that a nominally-frozen price visibly decays in real terms.
  const CPI: Record<string, number> = {};
  const MONTHS: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = `2026-${String(i + 1).padStart(2, "0")}`;
    MONTHS.push(m);
    CPI[m] = 100 * Math.pow(1.05, i);
  }
  const series = (merchant: string, amounts: number[]) =>
    MONTHS.map((m, i) => ars(merchant, m, amounts[i]));

  const frozen = series("PRIMEVIDEO", MONTHS.map(() => 1000));
  const indexed = series("OSDE", MONTHS.map((_, i) => Math.round(1000 * Math.pow(1.05, i))));
  const supermarket = series("COTO", [12000, 48000, 21000, 91000, 33000, 67000, 15000, 84000, 29000, 55000, 38000, 71000]);

  it("reads a frozen nominal price as pegged, even though it is falling in real terms", () => {
    const r = detectRecurring(frozen, { cpi: CPI });
    expect(r[0]).toMatchObject({ confidence: "high", priceRegime: "pegged" });
  });

  it("reads a CPI-tracking price as indexed, even though it repeats no nominal figure", () => {
    const r = detectRecurring(indexed, { cpi: CPI });
    expect(r[0]).toMatchObject({ confidence: "high", priceRegime: "indexed" });
  });

  it("rejects a merchant that neither holds a price nor tracks the index", () => {
    const r = detectRecurring(supermarket, { cpi: CPI });
    expect(r[0]).toMatchObject({ status: "active", confidence: "low", priceRegime: null });
  });

  // The two regimes are genuinely distinct: each charge is caught by one test and missed by
  // the other, which is why confidence needs both and not a single dispersion figure.
  it("misses the indexed charge when only the nominal test can run", () => {
    expect(detectRecurring(indexed)[0]).toMatchObject({ confidence: "low", priceRegime: null });
    expect(detectRecurring(frozen)[0]).toMatchObject({ confidence: "high", priceRegime: "pegged" });
  });

  it("reads stability off the current currency only, never across a migration", () => {
    // Five flat ARS months would peg outright; the USD months it bills in now do not.
    const migrated = [
      ...["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"].map(m => ars("SEEKER", m, 4199)),
      ...[["2026-06", 3], ["2026-07", 41], ["2026-08", 12], ["2026-09", 77], ["2026-10", 25]]
        .map(([m, a]) => usd("SEEKER", m as string, a as number)),
    ];
    const r = detectRecurring(migrated, { cpi: CPI });
    expect(r[0]).toMatchObject({ currency: "USD", currencies: ["ARS", "USD"], confidence: "low" });
  });

  it("sorts high confidence above low within the active group", () => {
    const r = detectRecurring([...supermarket, ...frozen], { cpi: CPI });
    expect(r.map(x => x.merchant)).toEqual(["PRIMEVIDEO", "COTO"]);
  });
});

describe("netting reversals", () => {
  it("nets an offsetting reversal instead of counting the charge twice", () => {
    const r = detectRecurring([
      ars("OSDE", "2026-04", 100), ars("OSDE", "2026-05", 100), ars("OSDE", "2026-06", 100),
      ars("OSDE", "2026-07", 100), ars("OSDE", "2026-07", 100), ars("OSDE", "2026-07", -100),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].lastAmount).toBe(100);   // not 200
    expect(r[0].pctChange).toBe(0);
  });
  it("drops a month that nets to zero rather than treating it as an occurrence", () => {
    const r = detectRecurring([
      ars("GYM", "2026-01", 500), ars("GYM", "2026-02", 500), ars("GYM", "2026-03", 500),
      ars("GYM", "2026-04", 500), ars("GYM", "2026-05", 500), ars("GYM", "2026-05", -500),
    ]);
    expect(r[0].occurrences).toBe(4);
    expect(r[0].lastMonth).toBe("2026-04");
  });
});
