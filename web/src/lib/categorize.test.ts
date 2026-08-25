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

// --- proposal store ---
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadCategoryFile, saveCategoryFile, pendingMerchants, acceptProposal, rejectProposal,
  type CategoryFile,
} from "@/lib/categorize";

const base: CategoryFile = {
  rules: [{ match: "SPOTIFY", category: "subscriptions", subcategory: "music" }],
  proposals: [{ merchant: "LA PANADERIA", sent: "LA PANADERIA", category: "food", subcategory: "bakery", confidence: "high" }],
  rejected: ["WEIRD THING"],
};

function tmpFile(contents: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cat-")), "merchant-categories.json");
  fs.writeFileSync(p, contents);
  return p;
}

describe("category file", () => {
  it("defaults the new sections when the file predates them", () => {
    expect(loadCategoryFile(tmpFile(JSON.stringify({ rules: base.rules }))))
      .toEqual({ rules: base.rules, proposals: [], rejected: [] });
  });

  it("round-trips, keeping one rule per line so an accept is a one-line diff", () => {
    const p = tmpFile("{}");
    saveCategoryFile(base, p);
    expect(loadCategoryFile(p)).toEqual(base);
    const text = fs.readFileSync(p, "utf8");
    expect(text).toContain(`    {"match":"SPOTIFY","category":"subscriptions","subcategory":"music"}`);
  });

  it("writes a file with no proposals or rejections without producing invalid JSON", () => {
    const p = tmpFile("{}");
    const empty: CategoryFile = { rules: base.rules, proposals: [], rejected: [] };
    saveCategoryFile(empty, p);
    expect(loadCategoryFile(p)).toEqual(empty);
  });
});

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

describe("rejectProposal", () => {
  it("remembers the rejection so the merchant is not asked about again", () => {
    const next = rejectProposal(base, "LA PANADERIA");
    expect(next.proposals).toEqual([]);
    expect(next.rejected).toContain("LA PANADERIA");
  });
});
