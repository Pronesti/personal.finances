import { describe, it, expect } from "vitest";
import { parseModes, withModes } from "@/lib/params";

describe("parseModes", () => {
  it("defaults to accrual + real", () => {
    expect(parseModes({})).toEqual({ spend: "accrual", value: "real" });
  });
  it("reads valid params, rejects junk", () => {
    expect(parseModes({ spend: "cash", value: "nominal" })).toEqual({ spend: "cash", value: "nominal" });
    expect(parseModes({ spend: "bogus", value: "nominal" })).toEqual({ spend: "accrual", value: "nominal" });
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
