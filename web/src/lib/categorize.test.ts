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

// --- the pure transformations over the stored rules, proposals and rejections. Where they are
// stored, and that the order of the rules survives a round trip, is rules.test.ts. ---
import {
  pendingMerchants, acceptProposal, upsertRule, rejectProposal, type CategoryData,
} from "@/lib/categorize";

const base: CategoryData = {
  rules: [{ match: "SPOTIFY", category: "subscriptions", subcategory: "music" }],
  proposals: [{ merchant: "LA PANADERIA", sent: "LA PANADERIA", category: "food", subcategory: "bakery", confidence: "high" }],
  rejected: ["WEIRD THING"],
};

describe("pendingMerchants", () => {
  it("skips merchants that are already ruled, proposed or rejected", () => {
    expect(pendingMerchants(base, ["SPOTIFY", "LA PANADERIA", "WEIRD THING", "NEW ONE"]))
      .toEqual(["NEW ONE"]);
  });
  it("uses categorize's own matcher, so a substring hit counts as ruled", () => {
    expect(pendingMerchants(base, ["SPOTIFY AB 1234"])).toEqual([]);
  });
});

describe("acceptProposal", () => {
  it("appends the rule last and drops the proposal", () => {
    const { data, added } = acceptProposal(base, "LA PANADERIA", { match: "LA PANADERIA", category: "food", subcategory: "bakery" });
    expect(added).toBe(true);
    expect(data.rules.at(-1)).toEqual({ match: "LA PANADERIA", category: "food", subcategory: "bakery" });
    expect(data.rules[0]).toEqual(base.rules[0]);
    expect(data.proposals).toEqual([]);
  });

  it("accepts an edited category and match", () => {
    const { data } = acceptProposal(base, "LA PANADERIA", { match: "PANADERIA", category: "shopping", subcategory: "groceries" });
    expect(data.rules.at(-1)).toEqual({ match: "PANADERIA", category: "shopping", subcategory: "groceries" });
  });

  it("never overwrites a manual rule that already claims the match, and says it did not", () => {
    const { data, added } = acceptProposal(base, "LA PANADERIA", { match: "SPOTIFY", category: "food", subcategory: "bakery" });
    expect(added).toBe(false);
    expect(data.rules).toEqual(base.rules); // manual override wins (spec §7)
    expect(data.proposals).toEqual([]);
  });
});

describe("upsertRule", () => {
  it("puts a new rule first, so it beats the rule that categorizes the merchant today", () => {
    const next = upsertRule(base, { match: "SPOTIFY HIFI", category: "entertainment" });
    expect(next.rules[0]).toEqual({ match: "SPOTIFY HIFI", category: "entertainment" });
    expect(next.rules).toHaveLength(2);
  });

  it("rewrites the rule for a match that already exists instead of duplicating it", () => {
    const next = upsertRule(base, { match: "spotify", category: "entertainment", subcategory: "audio" });
    expect(next.rules).toEqual([{ match: "spotify", category: "entertainment", subcategory: "audio" }]);
  });

  it("leaves proposals and rejections alone", () => {
    const next = upsertRule(base, { match: "COTO", category: "food" });
    expect(next.proposals).toEqual(base.proposals);
    expect(next.rejected).toEqual(base.rejected);
  });
});

describe("rejectProposal", () => {
  it("remembers the rejection so the merchant is not asked about again", () => {
    const next = rejectProposal(base, "LA PANADERIA");
    expect(next.proposals).toEqual([]);
    expect(next.rejected).toContain("LA PANADERIA");
  });
});
