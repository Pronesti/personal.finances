import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { migrate, openDb } from "@/lib/db";
import { loadRules, loadCategoryData, saveCategoryData } from "@/lib/rules";
import { loadAliases, saveAliases, applyAlias, type Alias } from "@/lib/aliases";
import { categorize, upsertRule, acceptProposal, type CategoryData } from "@/lib/categorize";

const base: CategoryData = {
  rules: [
    { match: "MOVISTAR AR", category: "entertainment", subcategory: "events" },
    { match: "MOVISTAR", category: "services", subcategory: "phone" },
    { match: "SPOTIFY", category: "subscriptions", subcategory: "music" },
  ],
  proposals: [
    { merchant: "LA PANADERIA", sent: "LA PANADERIA", category: "food", subcategory: "bakery", confidence: "high" },
    { merchant: "NICKYCHEESE", sent: "NICKYCHEESE", category: "food", subcategory: "restaurant", confidence: "low" },
  ],
  rejected: ["WEIRD THING"],
};

const aliases: Alias[] = [
  { match: "PEDIDOSYA PLUS", alias: "PEDIDOSYA PLUS" },
  { match: "PEDIDOSYA", alias: "PEDIDOSYA" },
];

// A directory holding the two tracked JSON files the tables were seeded from, so the import can
// be exercised without reading — or depending on the contents of — the repo's real data/.
function seedDir(categories: unknown, alias: unknown = { aliases }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
  fs.writeFileSync(path.join(dir, "merchant-categories.json"), JSON.stringify(categories));
  fs.writeFileSync(path.join(dir, "merchant-aliases.json"), JSON.stringify(alias));
  return dir;
}

describe("category store", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(":memory:"); });

  it("starts empty, so no test inherits the repo's real rules", () => {
    expect(loadCategoryData(db)).toEqual({ rules: [], proposals: [], rejected: [] });
  });

  it("round-trips rules, proposals and rejections", () => {
    saveCategoryData(db, base);
    expect(loadCategoryData(db)).toEqual(base);
  });

  it("keeps rule order, which is the whole meaning of a first-match-wins list", () => {
    saveCategoryData(db, base);
    expect(loadRules(db).map(r => r.match)).toEqual(["MOVISTAR AR", "MOVISTAR", "SPOTIFY"]);
    expect(categorize("MOVISTAR ARENA", "purchases", loadRules(db)))
      .toEqual({ category: "entertainment", subcategory: "events" });
  });

  it("keeps that order after a rule is inserted first — position, not insertion order", () => {
    saveCategoryData(db, base);
    saveCategoryData(db, upsertRule(loadCategoryData(db), { match: "MOVISTAR AR PLUS", category: "food" }));
    expect(loadRules(db).map(r => r.match))
      .toEqual(["MOVISTAR AR PLUS", "MOVISTAR AR", "MOVISTAR", "SPOTIFY"]);
  });

  it("keeps an accepted rule last, where it loses to every rule written by hand", () => {
    saveCategoryData(db, base);
    const { data } = acceptProposal(loadCategoryData(db), "LA PANADERIA",
      { match: "LA PANADERIA", category: "food", subcategory: "bakery" });
    saveCategoryData(db, data);
    expect(loadRules(db).at(-1)).toEqual({ match: "LA PANADERIA", category: "food", subcategory: "bakery" });
    expect(loadCategoryData(db).proposals.map(p => p.merchant)).toEqual(["NICKYCHEESE"]);
  });

  it("omits subcategory rather than storing it as null, so a saved rule loads back equal", () => {
    const rule = { match: "COTO", category: "food" } as const;
    saveCategoryData(db, { rules: [rule], proposals: [], rejected: [] });
    expect(loadRules(db)).toEqual([rule]);
  });

  it("replaces the previous contents instead of appending to them", () => {
    saveCategoryData(db, base);
    saveCategoryData(db, { rules: [], proposals: [], rejected: [] });
    expect(loadCategoryData(db)).toEqual({ rules: [], proposals: [], rejected: [] });
  });
});

describe("alias store", () => {
  it("round-trips in order, so the longer prefix still wins", () => {
    const db = openDb(":memory:");
    saveAliases(db, aliases);
    expect(loadAliases(db)).toEqual(aliases);
    expect(applyAlias("PEDIDOSYA PLUS", loadAliases(db))).toBe("PEDIDOSYA PLUS");
  });
});

describe("seeding from the tracked JSON files", () => {
  it("imports both files in file order on a fresh database", () => {
    const db = openDb(":memory:", seedDir(base));
    expect(loadCategoryData(db)).toEqual(base);
    expect(loadAliases(db)).toEqual(aliases);
  });

  it("defaults the sections a file predating them does not carry", () => {
    const db = openDb(":memory:", seedDir({ rules: base.rules }, {}));
    expect(loadCategoryData(db)).toEqual({ rules: base.rules, proposals: [], rejected: [] });
    expect(loadAliases(db)).toEqual([]);
  });

  it("is a no-op on a database that already has rules, so a correction survives a restart", () => {
    const dir = seedDir(base);
    const db = openDb(":memory:", dir);
    saveCategoryData(db, upsertRule(loadCategoryData(db), { match: "SPOTIFY", category: "entertainment" }));
    migrate(db, dir); // what the next openDb() would do
    expect(loadRules(db)[0]).toEqual({ match: "SPOTIFY", category: "entertainment" });
    expect(loadRules(db)).toHaveLength(3);
  });

  it("survives the files being gone, which is what deleting them will look like", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
    const db = openDb(":memory:", dir);
    expect(loadCategoryData(db)).toEqual({ rules: [], proposals: [], rejected: [] });
    expect(loadAliases(db)).toEqual([]);
  });
});
