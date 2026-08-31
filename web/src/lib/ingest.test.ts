import { describe, it, expect } from "vitest";
import { cycleMonth, statementToRows, ingestFile } from "@/lib/ingest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { realias } from "@/lib/queries";
import { mergeAlias } from "@/lib/aliases";
import type { Rule } from "@/lib/categorize";
import type { StatementJson } from "@/lib/integrity";
import { fixture, rules, aliases } from "@/lib/__fixtures__/statement";

describe("cycleMonth", () => {
  it("keys the cycle by its midpoint, not the closing month", () => {
    expect(cycleMonth("2026-07-30", "2026-07-02")).toBe("2026-07");
    expect(cycleMonth("2026-07-02", "2026-05-28")).toBe("2026-06");
    expect(cycleMonth("2025-10-02", "2025-08-28")).toBe("2025-09");
  });
  it("falls back to closing minus ~15 days when prev missing", () => {
    expect(cycleMonth("2026-07-30", null)).toBe("2026-07");
    expect(cycleMonth("2026-07-02", null)).toBe("2026-06");
  });
});

describe("statementToRows", () => {
  it("maps statement with cycle_month, categorizes, filters zero installments", () => {
    const r = statementToRows(fixture, rules, aliases);
    expect(r.statement).toMatchObject({ file: "visa_2026_07_30.pdf", cycle_month: "2026-07" });
    expect(r.transactions).toHaveLength(6);
    expect(r.transactions.find(t => t.description.startsWith("OSDE"))).toMatchObject({ merchant: "OSDE", category: "health" });
    expect(r.installments).toEqual([{ month: "2026-08", amount_ars: 375290.39 }]);
    expect(r.alerts).toEqual([]);
  });
  it("maps the bank's terms — limits, rates, previous balance — and nulls their absence", () => {
    const r = statementToRows(fixture, rules, aliases);
    // The fixture carries no limits/rates block, mirroring an older parse: absent, never 0.
    expect(r.statement).toMatchObject({ prev_balance_ars: null, limit_purchase: null, rate_tna_pct: null, rate_tem_pct: null });
    const full: StatementJson = structuredClone(fixture);
    full.balances!.previous_ars = 3869292.39;
    full.limits = { purchase: 20000000 };
    full.rates = { annual_nominal_ars: 69.44, monthly_effective_ars: 5.707 };
    expect(statementToRows(full, rules, aliases).statement).toMatchObject({
      prev_balance_ars: 3869292.39, limit_purchase: 20000000, rate_tna_pct: 69.44, rate_tem_pct: 5.707,
    });
  });
  it("carries integrity alerts", () => {
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    expect(statementToRows(bad, rules, aliases).alerts).toHaveLength(1);
  });
});

describe("ingestFile", () => {
  it("is idempotent per file and persists alerts", () => {
    const db = openDb(":memory:");
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    ingestFile(db, bad, rules, aliases);
    ingestFile(db, bad, rules, aliases);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 6 });
    expect(db.prepare("SELECT COUNT(*) n FROM upcoming_installments").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM alerts").get()).toEqual({ n: 1 });
  });
});

describe("ingestFile idempotency", () => {
  it("re-ingesting the same file replaces it instead of duplicating", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules, aliases);
    const report = ingestFile(db, fixture, rules, aliases);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 6 });
    expect(report.replaced).toEqual(["visa_2026_07_30.pdf"]);
  });

  it("supersedes the same cycle uploaded under a different filename", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules, aliases);
    const report = ingestFile(db, { ...fixture, file: "visa_july.pdf" } satisfies StatementJson, rules, aliases);
    expect(db.prepare("SELECT file FROM statements").all()).toEqual([{ file: "visa_july.pdf" }]);
    expect(report.replaced).toEqual(["visa_2026_07_30.pdf"]);
  });

  it("reports what it ingested", () => {
    const db = openDb(":memory:");
    expect(ingestFile(db, fixture, rules, aliases)).toMatchObject({
      file: "visa_2026_07_30.pdf", brand: "visa", cycle_month: "2026-07",
      transactions: 6, replaced: [], alerts: [],
    });
  });

  it("keeps a different brand closing the same day", () => {
    const db = openDb(":memory:");
    ingestFile(db, fixture, rules, aliases);
    ingestFile(db, { ...fixture, file: "mc.pdf", brand: "mastercard" } satisfies StatementJson, rules, aliases);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 2 });
  });
});

// The property the whole alias feature rests on: applyAlias runs at ingest time, so a merge saved
// from the UI has to rewrite the rows already loaded — and it has to rewrite them to exactly what
// the next `npm run ingest` will compute, or that ingest silently reverts the merge.
describe("realias", () => {
  const rules: Rule[] = [
    { match: "PLAYSTATION NETWORK", category: "entertainment", subcategory: "games" },
  ];

  // Two statement lines the parser has no way to see as one shop: only PLAYSTATION NETWORK is
  // claimed by a rule, so merging them has to move a category as well as a name.
  function statement(): StatementJson {
    const json = structuredClone(fixture);
    json.transactions = [
      { section: "purchases", block: 1, date: "2026-07-10", description: "PLAYSTATION", ars: 1000, usd: null, installment_number: null, installment_count: null },
      { section: "purchases", block: 1, date: "2026-07-11", description: "PLAYSTATION NETWORK", ars: 2000, usd: null, installment_number: null, installment_count: null },
      { section: "taxes_and_charges", block: null, date: null, description: "IVA RG 4240 21%", ars: 210, usd: null, installment_number: null, installment_count: null },
    ];
    return json;
  }

  type Derived = { description: string; merchant: string; category: string; subcategory: string | null };
  const derived = (db: Database.Database) => db.prepare(
    "SELECT description, merchant, category, subcategory FROM transactions ORDER BY description"
  ).all() as Derived[];

  it("collapses two merchants into one and re-derives the category that follows the name", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement(), rules, []);
    expect(derived(db)).toMatchObject([
      { merchant: "IVA RG 4240 21%", category: "taxes_fees" },
      { merchant: "PLAYSTATION", category: "other", subcategory: null },
      { merchant: "PLAYSTATION NETWORK", category: "entertainment", subcategory: "games" },
    ]);

    const aliases = mergeAlias([], "PLAYSTATION", "PLAYSTATION NETWORK");
    expect(realias(db, rules, aliases)).toBe(1);
    expect(derived(db)).toMatchObject([
      { merchant: "IVA RG 4240 21%", category: "taxes_fees" },
      // The name moved, and the category moved with it: the rule matches on the merchant, so
      // leaving it on "other" is precisely the disagreement the next ingest would resolve.
      { description: "PLAYSTATION", merchant: "PLAYSTATION NETWORK", category: "entertainment", subcategory: "games" },
      { description: "PLAYSTATION NETWORK", merchant: "PLAYSTATION NETWORK", category: "entertainment" },
    ]);
  });

  it("computes exactly what the next `npm run ingest` computes", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement(), rules, []);
    const aliases = mergeAlias([], "PLAYSTATION", "PLAYSTATION NETWORK");
    realias(db, rules, aliases);
    const afterMerge = derived(db);

    // What scripts/ingest.ts does on the next run: same JSON, same rules, the saved aliases.
    ingestFile(db, statement(), rules, aliases);
    expect(derived(db)).toEqual(afterMerge);
  });

  it("leaves the statement line alone, so a charge still reads back to the PDF", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement(), rules, []);
    realias(db, rules, mergeAlias([], "PLAYSTATION", "PLAYSTATION NETWORK"));
    expect(derived(db).map(r => r.description))
      .toEqual(["IVA RG 4240 21%", "PLAYSTATION", "PLAYSTATION NETWORK"]);
  });

  it("changes nothing on a second run, so it can follow every save", () => {
    const db = openDb(":memory:");
    ingestFile(db, statement(), rules, []);
    const aliases = mergeAlias([], "PLAYSTATION", "PLAYSTATION NETWORK");
    realias(db, rules, aliases);
    expect(realias(db, rules, aliases)).toBe(0);
  });

  it("keeps a hand correction, because a correction is a rule and rules win here too", () => {
    const db = openDb(":memory:");
    // What recategorizeAction stores: the corrected rule goes FIRST, ahead of the one that
    // categorized the merchant before it.
    const corrected: Rule[] = [{ match: "PLAYSTATION", category: "subscriptions" }, ...rules];
    ingestFile(db, statement(), rules, []);
    realias(db, corrected, mergeAlias([], "PLAYSTATION", "PLAYSTATION NETWORK"));
    expect(derived(db).filter(r => r.merchant === "PLAYSTATION NETWORK"))
      .toMatchObject([{ category: "subscriptions" }, { category: "subscriptions" }]);
  });
});
