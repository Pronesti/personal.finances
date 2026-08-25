import { describe, it, expect } from "vitest";
import { project } from "@/lib/projection";

const base = {
  startMonth: "2026-08",
  horizon: 3,
  upcoming: [
    { month: "2026-08", amount: 400000 },
    { month: "2026-09", amount: 300000 },
  ],
  recurringMonthly: 100000,
  variableHistory: [80000, 100000, 120000],
  inflation: 0.02,
  mode: "nominal" as const,
};

describe("project", () => {
  it("emits one row per horizon month starting at startMonth", () => {
    expect(project(base).map(p => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("takes the certain layer straight from the contractual schedule, zero past its end", () => {
    const p = project(base);
    expect(p[0].certain).toBe(400000);
    expect(p[1].certain).toBe(300000);
    expect(p[2].certain).toBe(0);
  });

  it("grows the expected and estimated layers with inflation in nominal mode", () => {
    const p = project(base);
    expect(p[0].expected).toBeCloseTo(100000 * 1.02);
    expect(p[2].expected).toBeCloseTo(100000 * 1.02 ** 3);
    expect(p[0].estLow).toBeCloseTo(80000 * 1.02);
    expect(p[0].estHigh).toBeCloseTo(120000 * 1.02);
  });

  it("holds expected flat and deflates only the contractual layer in real mode", () => {
    const p = project({ ...base, mode: "real" });
    expect(p[2].expected).toBeCloseTo(100000);
    expect(p[2].estHigh).toBeCloseTo(120000);
    expect(p[0].certain).toBeCloseTo(400000 / 1.02);
    expect(p[1].certain).toBeCloseTo(300000 / 1.02 ** 2);
  });

  it("neither grows nor deflates in usd mode", () => {
    const p = project({ ...base, mode: "usd" });
    expect(p[0].certain).toBe(400000);
    expect(p[0].expected).toBe(100000);
  });

  it("zeroes the estimated band when there is no variable history", () => {
    const p = project({ ...base, variableHistory: [] });
    expect(p[0].estLow).toBe(0);
    expect(p[0].estHigh).toBe(0);
  });
});
