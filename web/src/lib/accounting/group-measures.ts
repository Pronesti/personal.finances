import type { AccountGroup } from "./catalog";
import { AccountingError, type Account, type Currency, type Journal } from "./model";

/** Selected ledger accounts, including descendants, counted once per group. */
export function groupMeasures(input: { group: AccountGroup; accounts: Account[]; journals: Journal[]; currency: Currency; from: string; to: string }) {
  const accounts = new Map(input.accounts.map(account => [account.id, account]));
  const included = (id: string) => {
    const visited = new Set<string>();
    let next: string | null = id;
    while (next !== null) {
      if (visited.has(next)) throw new AccountingError("account_cycle");
      visited.add(next);
      if (input.group.accountIds.includes(next)) return true;
      next = accounts.get(next)?.parentId ?? null;
    }
    return false;
  };
  const result = { expenseMinor: 0, debtMinor: 0, repaymentMinor: 0 };
  const add = (field: keyof typeof result, value: number) => {
    const total = result[field] + value;
    if (!Number.isSafeInteger(total)) throw new AccountingError("invalid_minor_units");
    result[field] = total;
  };
  for (const journal of input.journals) {
    if (journal.currency !== input.currency || journal.effectiveDate > input.to) continue;
    for (const line of journal.lines) {
      const account = accounts.get(line.accountId);
      if (!account || !included(account.id)) continue;
      if (account.type === "liability") {
        add("debtMinor", line.creditMinor - line.debitMinor);
        if (journal.kind === "repayment" && journal.effectiveDate >= input.from) add("repaymentMinor", line.debitMinor - line.creditMinor);
      }
      if (account.type === "expense" && journal.effectiveDate >= input.from) add("expenseMinor", line.debitMinor - line.creditMinor);
    }
  }
  return result;
}
