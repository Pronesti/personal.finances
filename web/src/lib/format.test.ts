import { describe, it, expect } from "vitest";
import { fmtArs, fmtPct, fmtMoney } from "@/lib/format";

describe("format", () => {
  it("formats ARS es-AR, no decimals", () => {
    expect(fmtArs(1234567.89).replace(/\u00a0/g, " ")).toBe("$ 1.234.568");
  });
  it("formats pct with sign, comma decimal, em dash for null", () => {
    expect(fmtPct(12.34)).toBe("+12,3%");
    expect(fmtPct(-4.06)).toBe("−4,1%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtMoney", () => {
  it("formats pesos for nominal and real, dollars for usd", () => {
    expect(fmtMoney(1500, "nominal")).toBe(fmtArs(1500));
    expect(fmtMoney(1500, "real")).toBe(fmtArs(1500));
    expect(fmtMoney(3.73, "usd")).toBe("US$ 3.73");
  });
});
