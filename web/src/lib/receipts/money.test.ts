import { describe, it, expect } from "vitest";
import { parseAmountCents, isAmount, parseQtyMilli, fmtCents, fmtArsCents } from "@/lib/receipts/money";

describe("parseAmountCents", () => {
  it("reads receipt amounts: decimal comma, no thousands separator", () => {
    expect(parseAmountCents("4454,63")).toBe(445463);
    expect(parseAmountCents("146931,91")).toBe(14693191);
    expect(parseAmountCents("0,00")).toBe(0);
  });
  it("reads negative discounts", () => {
    expect(parseAmountCents("-1336,39")).toBe(-133639);
    expect(parseAmountCents("−0,01")).toBe(-1); // unicode minus
  });
  it("tolerates thousands dots and OCR spaces", () => {
    expect(parseAmountCents("1.234,56")).toBe(123456);
    expect(parseAmountCents("3665 , 20")).toBe(366520);
    expect(parseAmountCents(" -916,30 ")).toBe(-91630);
  });
  it("rejects anything that is not exactly an amount", () => {
    for (const bad of ["5/65,00", "0,172 x 25899,00", "4454.63", "4454,6", "12", "", "[A]"]) {
      expect(parseAmountCents(bad), bad).toBeNull();
      expect(isAmount(bad), bad).toBe(false);
    }
  });
});

describe("parseQtyMilli", () => {
  it("reads kilograms with three decimals and unit counts", () => {
    expect(parseQtyMilli("0,172")).toBe(172);
    expect(parseQtyMilli("1,285")).toBe(1285);
    expect(parseQtyMilli("4,000")).toBe(4000);
    expect(parseQtyMilli("12,000")).toBe(12000);
  });
  it("rejects two-decimal and integer forms", () => {
    expect(parseQtyMilli("1,28")).toBeNull();
    expect(parseQtyMilli("4")).toBeNull();
  });
});

describe("formatting", () => {
  it("prints Argentine decimals", () => {
    expect(fmtCents(10972834)).toBe("109.728,34");
    expect(fmtCents(-133639)).toBe("-1.336,39");
    expect(fmtArsCents(10972834)).toMatch(/^\$\s?109\.728,34$/);
  });
});
