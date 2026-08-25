import { describe, it, expect } from "vitest";
import { cycleMonth, statementToRows, ingestFile } from "@/lib/ingest";
import { openDb } from "@/lib/db";
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
