import { describe, it, expect } from "vitest";
import { checkStatement, type StatementJson } from "@/lib/integrity";

const base = {
  file: "x.json", brand: "visa",
  period: { closing_date: "2026-07-30", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 150 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS DE JUAN PEREZ", block: 1, ars: 60, usd: null },
    { concept: "SALDO ACTUAL", block: null, ars: 150, usd: null },
  ],
  upcoming_installments: [],
  transactions: [
    { section: "purchases", block: 1, date: "2026-07-10", description: "A", ars: 100, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-11", description: "A REVERSAL", ars: -40, usd: null, installment_number: null, installment_count: null },
  ],
} satisfies StatementJson;

describe("checkStatement", () => {
  it("passes when declared block total matches net (incl. negative) purchases", () => {
    expect(checkStatement(base)).toEqual([]);
  });
  it("flags mismatch beyond 1 peso tolerance", () => {
    const bad = structuredClone(base);
    bad.transactions[0].ars = 95;
    const alerts = checkStatement(bad);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "math_mismatch", expected: 60, actual: 55 });
  });
  it("flags SALDO ACTUAL vs balances mismatch", () => {
    const bad = structuredClone(base);
    bad.balances!.current_ars = 999;
    expect(checkStatement(bad).some(a => a.kind === "balance_mismatch")).toBe(true);
  });
});
