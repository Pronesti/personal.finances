import { describe, it, expect } from "vitest";
import { periodsFor, resolvePeriod, parseGranularity, parseModes } from "@/lib/scope";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

describe("periodsFor", () => {
  it("keeps months as they are, in order", () => {
    expect(periodsFor(MONTHS, "month")).toEqual(MONTHS);
  });

  it("collapses months into their quarter, once each", () => {
    expect(periodsFor(MONTHS, "quarter")).toEqual(["2026-Q1", "2026-Q2"]);
  });

  it("collapses everything into one bucket at 'all'", () => {
    expect(periodsFor(MONTHS, "all")).toEqual(["all"]);
  });

  it("has no periods when nothing is on file", () => {
    expect(periodsFor([], "month")).toEqual([]);
  });
});

describe("resolvePeriod", () => {
  const periods = periodsFor(MONTHS, "month");

  it("takes a period the list actually has", () => {
    expect(resolvePeriod(periods, "2026-02", "latest")).toBe("2026-02");
  });

  // A label from another granularity is not valid here, so switching granularity has to fall
  // back rather than scope the page to a period that does not exist.
  it("falls back to the newest period when the label is from another granularity", () => {
    expect(resolvePeriod(periods, "2026-Q1", "latest")).toBe("2026-04");
  });

  it("falls back to the newest period when there is no param", () => {
    expect(resolvePeriod(periods, undefined, "latest")).toBe("2026-04");
  });

  // A repeated query param arrives as an array; it names no single period.
  it("ignores a non-string param", () => {
    expect(resolvePeriod(periods, ["2026-02", "2026-03"], "latest")).toBe("2026-04");
  });

  it("falls back to the whole history where that is the page's default", () => {
    expect(resolvePeriod(periods, undefined, "all-first")).toBe("all");
  });

  it("has an empty selection when nothing is on file", () => {
    expect(resolvePeriod([], undefined, "latest")).toBe("");
  });
});

describe("parsing", () => {
  it("defaults to month and to real accrual pre-tax", () => {
    expect(parseGranularity({})).toBe("month");
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real", tax: "excl" });
  });

  it("reads the query", () => {
    expect(parseGranularity({ g: "quarter" })).toBe("quarter");
    expect(parseModes({ spend: "cash", value: "usd", tax: "incl" }))
      .toEqual({ spend: "cash", value: "usd", tax: "incl" });
  });
});
