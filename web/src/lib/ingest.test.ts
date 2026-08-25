import { describe, it, expect } from "vitest";
import { cycleMonth, statementToRows, ingestFile } from "@/lib/ingest";
import { openDb } from "@/lib/db";
import type { StatementJson } from "@/lib/integrity";
import type { Rule } from "@/lib/categorize";

const rules: Rule[] = [{ match: "OSDE", category: "health", subcategory: "insurance" }];

const fixture = {
  file: "visa_2026_07_30.pdf",
  brand: "visa",
  period: { closing_date: "2026-07-30", due_date: "2026-08-07", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 100120, current_usd: 32.32, minimum_payment_ars: 280310.0 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS DE JUAN PEREZ", block: 1, ars: 100120, usd: 6.99 },
    { concept: "SALDO ACTUAL", block: null, ars: 100120, usd: null },
  ],
  upcoming_installments: [
    { month: "2026-08", amount_ars: 375290.39 },
    { month: "2026-09", amount_ars: 0.0 },
  ],
  transactions: [
    { section: "payments", block: null, date: "2026-07-13", description: "SU PAGO EN PESOS", ars: -3864892.39, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-10", description: "OSDE 000012345678901", ars: 120000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-12", description: "OSDE 000012345678901", ars: -70000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-11", description: "MERPAGO*TIENDANEWSAN", ars: 50120, usd: null, installment_number: 13, installment_count: 18 },
    { section: "purchases", block: 1, date: "2026-07-09", description: "APPLE.COM/BILL MT8XM2T22USD 6,99", ars: null, usd: 6.99, installment_number: null, installment_count: null },
    { section: "taxes_and_charges", block: null, date: null, description: "IVA RG 4240 21%( 37759,04)", ars: 7929.39, usd: null, installment_number: null, installment_count: null },
  ],
} satisfies StatementJson;

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
    const r = statementToRows(fixture, rules);
    expect(r.statement).toMatchObject({ file: "visa_2026_07_30.pdf", cycle_month: "2026-07" });
    expect(r.transactions).toHaveLength(6);
    expect(r.transactions.find(t => t.description.startsWith("OSDE"))).toMatchObject({ merchant: "OSDE", category: "health" });
    expect(r.installments).toEqual([{ month: "2026-08", amount_ars: 375290.39 }]);
    expect(r.alerts).toEqual([]);
  });
  it("carries integrity alerts", () => {
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    expect(statementToRows(bad, rules).alerts).toHaveLength(1);
  });
});

describe("ingestFile", () => {
  it("is idempotent per file and persists alerts", () => {
    const db = openDb(":memory:");
    const bad = structuredClone(fixture);
    bad.declared_totals![0].ars = 999999;
    ingestFile(db, bad, rules);
    ingestFile(db, bad, rules);
    expect(db.prepare("SELECT COUNT(*) n FROM statements").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 6 });
    expect(db.prepare("SELECT COUNT(*) n FROM upcoming_installments").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM alerts").get()).toEqual({ n: 1 });
  });
});
