import { describe, it, expect } from "vitest";
import { personalInflationIndex } from "@/lib/inflation";

const cpi = { "2026-01": 100, "2026-02": 110, "2026-03": 121 };
const r = (merchant: string, month: string, ars: number) => ({ merchant, month, ars });

describe("personalInflationIndex", () => {
  it("starts both series at 100 in the first month", () => {
    const p = personalInflationIndex([r("A", "2026-01", 100), r("A", "2026-02", 100)], cpi);
    expect(p[0]).toEqual({ month: "2026-01", personal: 100, official: 100 });
  });

  it("tracks the basket's own repricing against the official index", () => {
    const p = personalInflationIndex([
      r("A", "2026-01", 100), r("A", "2026-02", 120), r("A", "2026-03", 150),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(120);
    expect(p[1].official).toBeCloseTo(110);
    expect(p[2].personal).toBeCloseTo(150);
    expect(p[2].official).toBeCloseTo(121);
  });

  it("chains on merchants present in BOTH months, so basket churn cannot distort it", () => {
    // B joins in February at a large amount; the Jan->Feb link must use A alone.
    const p = personalInflationIndex([
      r("A", "2026-01", 100),
      r("A", "2026-02", 110), r("B", "2026-02", 900),
      r("A", "2026-03", 121), r("B", "2026-03", 990),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(110);
    expect(p[2].personal).toBeCloseTo(121); // (121+990)/(110+900) = 1.1 chained onto 110
  });

  it("carries the index forward unchanged when two months share no merchant", () => {
    const p = personalInflationIndex([
      r("A", "2026-01", 100), r("B", "2026-02", 500), r("B", "2026-03", 600),
    ], cpi);
    expect(p[1].personal).toBeCloseTo(100);
    expect(p[2].personal).toBeCloseTo(120);
  });

  it("returns an empty series for an empty basket", () => {
    expect(personalInflationIndex([], cpi)).toEqual([]);
  });
});
