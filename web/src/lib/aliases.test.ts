import { describe, it, expect } from "vitest";
import { applyAlias, type Alias } from "@/lib/aliases";
import { normalizeMerchant } from "@/lib/categorize";
import { addMonth, monthsBetween } from "@/lib/months";

const aliases: Alias[] = [
  { match: "PEDIDOSYA PLUS", alias: "PEDIDOSYA PLUS" },
  { match: "PEDIDOSYA PROPINA", alias: "PEDIDOSYA PROPINA" },
  { match: "GOOGLE YOUTUBEP", alias: "GOOGLE YOUTUBE PREMIUM" },
  { match: "HELP HBOM", alias: "HBO MAX" },
  { match: "HELP MAX COM", alias: "HBO MAX" },
  { match: "SANCOR COOP", alias: "SANCOR" },
  { match: "PERSONAL", alias: "PERSONAL" },
  { match: "MOVISTAR AR", alias: "MOVISTAR ARENA" },
  { match: "CARREFOUR", alias: "CARREFOUR" },
  { match: "LEF CASA DE MUSICA", alias: "LEF CASA DE MUSICA" },
];

describe("applyAlias", () => {
  it("collapses the 17 GOOGLE YOUTUBEP token variants into one merchant", () => {
    expect(applyAlias("GOOGLE YOUTUBEP P18NBKWS", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
    expect(applyAlias("GOOGLE YOUTUBEP P1MD102O", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
    expect(applyAlias("GOOGLE YOUTUBEPREMIUM", aliases)).toBe("GOOGLE YOUTUBE PREMIUM");
  });
  it("unifies all three HBO Max namings, including the oldest", () => {
    expect(applyAlias("HELP HBOM", aliases)).toBe("HBO MAX");
    expect(applyAlias("HELP HBOMAX COM", aliases)).toBe("HBO MAX");
    expect(applyAlias("HELP MAX COM", aliases)).toBe("HBO MAX");
  });
  it("unifies truncated and punctuated variants (rev note 7)", () => {
    expect(applyAlias("PERSONAL FLOW", aliases)).toBe("PERSONAL");
    expect(applyAlias("SANCOR COOP SE0000012345678-020-000", aliases)).toBe("SANCOR");
    expect(applyAlias("MOVISTAR AREN", aliases)).toBe("MOVISTAR ARENA");
  });
  it("rejoins installment series split by PDF truncation", () => {
    expect(applyAlias("LEF CASA DE MUSICA S", aliases)).toBe("LEF CASA DE MUSICA");
    expect(applyAlias("LEF CASA DE MUSICA SA - S", aliases)).toBe("LEF CASA DE MUSICA");
  });
  it("merges store branches so branch names stop faking new merchants", () => {
    expect(applyAlias("CARREFOUR VILLA DEVOTO", aliases)).toBe("CARREFOUR");
    expect(applyAlias("CARREFOUR VELEZ SARSFIELD", aliases)).toBe("CARREFOUR");
  });
  it("is prefix-matched and first-match-wins, so PedidosYa stays split by product", () => {
    expect(applyAlias("PEDIDOSYA PLUS", aliases)).toBe("PEDIDOSYA PLUS");
    expect(applyAlias("PEDIDOSYA PROPINAS", aliases)).toBe("PEDIDOSYA PROPINA");
    expect(applyAlias("PEDIDOSYA MCDONALDS FLO", aliases)).toBe("PEDIDOSYA MCDONALDS FLO");
  });
  it("passes unknown merchants through untouched", () => {
    expect(applyAlias("XYZ RANDOM SHOP", aliases)).toBe("XYZ RANDOM SHOP");
  });
});

describe("normalizeMerchant currency tails", () => {
  it("strips amounts that use spaces as thousands separators", () => {
    expect(normalizeMerchant("APPLE.COM/US USD 3 262,43")).toBe("APPLE COM/US");
    expect(normalizeMerchant("NATIONAL CAR RENTAL USD 1 303,52")).toBe("NATIONAL CAR RENTAL");
  });
  it("strips non-USD currency tails too", () => {
    expect(normalizeMerchant("MERPAGO*CABIFY2612EWOUEFC CLP 4 220,00")).toBe("CABIFY2612EWOUEFC");
    expect(normalizeMerchant("MIRADOR COSTANERA CENTER CLP 46 000,00")).toBe("MIRADOR COSTANERA CENTER");
  });
  it("still handles the Phase 1 cases", () => {
    expect(normalizeMerchant("Spotify USD 3,73")).toBe("SPOTIFY");
    expect(normalizeMerchant("APPLE.COM/BILL MT8ZSVB45USD 9,99")).toBe("APPLE COM/BILL");
  });
});

describe("months", () => {
  it("adds months across year boundaries", () => {
    expect(addMonth("2026-07")).toBe("2026-08");
    expect(addMonth("2026-12")).toBe("2027-01");
    expect(addMonth("2026-11", 3)).toBe("2027-02");
    expect(addMonth("2026-01", -2)).toBe("2025-11");
  });
  it("measures inclusive spans", () => {
    expect(monthsBetween("2026-01", "2026-01")).toBe(1);
    expect(monthsBetween("2025-11", "2026-02")).toBe(4);
  });
});
