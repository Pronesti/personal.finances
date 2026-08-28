import { describe, it, expect } from "vitest";
import { periodOf } from "@/lib/months";

describe("periodOf", () => {
  it("passes months through unchanged", () => {
    expect(periodOf("2026-07", "month")).toBe("2026-07");
  });

  it("maps every month to its quarter, including the boundaries", () => {
    const q = (m: string) => periodOf(m, "quarter");
    expect([q("2026-01"), q("2026-03")]).toEqual(["2026-Q1", "2026-Q1"]);
    expect([q("2026-04"), q("2026-06")]).toEqual(["2026-Q2", "2026-Q2"]);
    expect([q("2026-07"), q("2026-09")]).toEqual(["2026-Q3", "2026-Q3"]);
    expect([q("2026-10"), q("2026-12")]).toEqual(["2026-Q4", "2026-Q4"]);
  });

  it("drops the month for years", () => {
    expect(periodOf("2026-12", "year")).toBe("2026");
    expect(periodOf("2025-01", "year")).toBe("2025");
  });
});
