import { expect, it } from "vitest";
import { baseCatalog, cardAccounts } from "./catalog";
import { groupMeasures } from "./group-measures";
import type { Journal } from "./model";

it("keeps grouped expenses, current liabilities and payment flows separate without counting descendants twice", () => {
  const accounts = [...baseCatalog(), ...cardAccounts("card-a", "My card")];
  const journal = (id: string, kind: Journal["kind"], date: string, rows: [string, number, number][]): Journal => ({
    id, commandKey: id, cardId: "card-a", currency: "ARS", effectiveDate: date, recordedAt: `${date}T12:00:00Z`, kind, reversesId: null, evidenceIds: ["source"],
    lines: rows.map(([accountId, debitMinor, creditMinor]) => ({ accountId, debitMinor, creditMinor, purchaseId: null, purposeId: null })),
  });
  const journals = [
    journal("purchase", "purchase", "2026-01-10", [["expense:home:cleaning", 10000, 0], ["card-a:ARS:billed", 0, 10000]]),
    journal("payment", "repayment", "2026-02-01", [["card-a:ARS:billed", 3000, 0], ["clearing:ARS:unresolved-source", 0, 3000]]),
    journal("credit", "credit", "2026-02-02", [["expense:home:cleaning", 0, 2000], ["card-a:ARS:billed", 2000, 0]]),
  ];
  const input = { group: { id: "custom", customName: "My group", labelKey: null, additive: false, accountIds: ["expense:home", "expense:home:cleaning", "card:card-a", "card-a:ARS:billed"] }, accounts, journals, currency: "ARS" as const, from: "2026-02-01", to: "2026-02-28" };
  expect(groupMeasures(input)).toEqual({ expenseMinor: -2000, debtMinor: 5000, repaymentMinor: 3000 });
  expect(groupMeasures({ ...input, currency: "USD" })).toEqual({ expenseMinor: 0, debtMinor: 0, repaymentMinor: 0 });
  expect(groupMeasures({ ...input, to: "2026-02-01" })).toEqual({ expenseMinor: 0, debtMinor: 7000, repaymentMinor: 3000 });
});
