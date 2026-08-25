import { describe, it, expect } from "vitest";
import { mepFor } from "@/lib/mep";

const table = { "2025-01": 1100, "2025-02": 1150, "2025-04": 1300 };

describe("mepFor", () => {
  it("returns the month's rate, else the nearest earlier one", () => {
    expect(mepFor("2025-02", table)).toBe(1150);
    expect(mepFor("2025-03", table)).toBe(1150);
    expect(mepFor("2026-08", table)).toBe(1300);
  });
  it("throws actionable errors naming the fetch script", () => {
    expect(() => mepFor("2025-01", {})).toThrow(/fetch-mep/);
    expect(() => mepFor("2024-01", table)).toThrow(/before 2024-01/);
  });
});
