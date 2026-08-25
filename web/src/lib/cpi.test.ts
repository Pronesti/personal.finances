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
