import { describe, it, expect } from "vitest";
import { parseModes, parseGranularity, periodWord, spanLabel, withModes } from "@/lib/params";

describe("parseModes", () => {
  it("defaults to accrual + real + pre-tax", () => {
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });
  it("reads valid params, rejects junk", () => {
    expect(parseModes({ spend: "cash", value: "nominal" }))
      .toEqual({ spend: "cash", value: "nominal", tax: "excl" });
    expect(parseModes({ spend: "bogus", value: "nominal" }))
      .toEqual({ spend: "accrual", value: "nominal", tax: "excl" });
    expect(parseModes({ value: "usd", tax: "incl" }))
      .toEqual({ spend: "accrual", value: "usd", tax: "incl" });
    expect(parseModes({ value: "bogus", tax: "bogus" }))
      .toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });
});

describe("parseGranularity", () => {
  it("defaults to month and rejects junk", () => {
    expect(parseGranularity({})).toBe("month");
    expect(parseGranularity({ g: "bogus" })).toBe("month");
  });
  it("reads every granularity, all included", () => {
    expect(parseGranularity({ g: "quarter" })).toBe("quarter");
    expect(parseGranularity({ g: "year" })).toBe("year");
    expect(parseGranularity({ g: "all" })).toBe("all");
  });
});

describe("granularity copy helpers", () => {
  it("names a bucket instead of a period for all", () => {
    expect(periodWord("month")).toBe("month");
    expect(periodWord("all")).toBe("period");
    expect(spanLabel("quarter")).toBe("the latest quarter");
    expect(spanLabel("all")).toBe("the whole history");
  });
});

describe("withModes", () => {
  it("builds hrefs preserving modes plus extras", () => {
    expect(withModes("/trends", { spend: "cash", value: "nominal" }))
      .toBe("/trends?spend=cash&value=nominal");
    expect(withModes("/compare", { spend: "cash", value: "real" }, { g: "quarter" }))
      .toBe("/compare?spend=cash&value=real&g=quarter");
  });
});
