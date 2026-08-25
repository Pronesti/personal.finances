import { describe, it, expect } from "vitest";
import { normalizeMerchant, categorize, type Rule } from "@/lib/categorize";

const rules: Rule[] = [
  { match: "MOVISTAR AR", category: "entertainment", subcategory: "events" },
  { match: "MOVISTAR", category: "services", subcategory: "phone" },
  { match: "OSDE", category: "health", subcategory: "insurance" },
  { match: "HBO MAX", category: "subscriptions", subcategory: "streaming" },
  { match: "PEDIDOSYA", category: "food", subcategory: "delivery" },
];

describe("normalizeMerchant", () => {
  it("strips marketplace prefixes incl. DLOCAL, punctuation to spaces, tails", () => {
    expect(normalizeMerchant("MERPAGO*TIENDANEWSAN")).toBe("TIENDANEWSAN");
    expect(normalizeMerchant("DLO*PEDIDOSYA PLUS")).toBe("PEDIDOSYA PLUS");
    expect(normalizeMerchant("DLOCAL*HELP HBOM")).toBe("HELP HBOM");
    expect(normalizeMerchant("PEDIDOSYA _ PLUS")).toBe("PEDIDOSYA PLUS");
    expect(normalizeMerchant("DLO*HELP_HBOMAX_COM")).toBe("HELP HBOMAX COM");
    expect(normalizeMerchant("help hbomax com")).toBe("HELP HBOMAX COM");
    expect(normalizeMerchant("Spotify USD 3,73")).toBe("SPOTIFY");
    expect(normalizeMerchant("APPLE.COM/BILL MT8ZSVB45USD 9,99")).toBe("APPLE COM/BILL");
    expect(normalizeMerchant("106851*MOVISTAR AREN")).toBe("MOVISTAR AREN");
  });
  it("strips both bare and ID:-prefixed account tails (real OSDE drift)", () => {
    expect(normalizeMerchant("OSDE 000012345678901")).toBe("OSDE");
    expect(normalizeMerchant("OSDE ID:000012345678901")).toBe("OSDE");
  });
});

describe("categorize", () => {
  it("first matching rule wins — Movistar Arena is events, not phone", () => {
    expect(categorize(normalizeMerchant("292746*MOVISTAR AREN"), "purchases", rules))
      .toEqual({ category: "entertainment", subcategory: "events" });
  });
  it("taxes_and_charges section is always taxes_fees", () => {
    expect(categorize(normalizeMerchant("IVA RG 4240 21%( 37759,04)"), "taxes_and_charges", rules))
      .toEqual({ category: "taxes_fees", subcategory: null });
  });
  it("unknown merchant falls back to other", () => {
    expect(categorize(normalizeMerchant("XYZ RANDOM SHOP"), "purchases", rules))
      .toEqual({ category: "other", subcategory: null });
  });
});

describe("categorize on aliased merchants", () => {
  // Matching drifted spellings is the alias map's job now (see aliases.test.ts); rules are
  // written against the canonical name the alias produces.
  it("matches rules written for the canonical alias names", () => {
    expect(categorize("HBO MAX", "purchases", rules).category).toBe("subscriptions");
  });
});
