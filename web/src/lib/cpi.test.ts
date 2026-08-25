import { describe, it, expect } from "vitest";
import { toReal, latestMonth } from "@/lib/cpi";

const table = { "2025-01": 100, "2025-02": 110, "2025-04": 133.1 };

describe("cpi", () => {
  it("deflates by index ratio", () => {
    expect(toReal(1000, "2025-01", "2025-02", table)).toBeCloseTo(1100);
  });
  it("falls back to nearest earlier month (2025-03 missing -> 2025-02)", () => {
    expect(toReal(1000, "2025-03", "2025-04", table)).toBeCloseTo(1210);
  });
  it("latestMonth", () => {
    expect(latestMonth(table)).toBe("2025-04");
  });
  it("throws actionable error on empty table", () => {
    expect(() => toReal(1, "2025-01", "2025-02", {})).toThrow(/fetch-ipc/);
  });
});

import { trailingMonthlyInflation } from "@/lib/cpi";

describe("trailingMonthlyInflation", () => {
  it("returns the geometric mean monthly rate over the trailing window", () => {
    const t = { "2026-01": 100, "2026-02": 110, "2026-03": 121 };
    expect(trailingMonthlyInflation(t, 6)).toBeCloseTo(0.1, 6);
  });
  it("honours the window length", () => {
    const t = { "2026-01": 100, "2026-02": 100, "2026-03": 100, "2026-04": 121 };
    expect(trailingMonthlyInflation(t, 2)).toBeCloseTo(0.1, 6);
  });
  it("throws actionably on a table too short to measure", () => {
    expect(() => trailingMonthlyInflation({ "2026-01": 100 })).toThrow(/fetch-ipc/);
  });
});
