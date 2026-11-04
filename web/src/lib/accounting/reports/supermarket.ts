import { buildAnalytics, type Analytics } from "../../receipts/analytics";
import type { ReceiptFact, ItemFact, RawReceiptItemFact } from "../../receipts/facts";
import { translate, type Locale, type MessageKey, type Vars } from "../../i18n";
import type { ReceiptAllocationFact } from "../read-model";
import { AccountingError } from "../model";
/** Reviewed canonical items power price comparisons; raw printed items power receipt savings. */
export function supermarketModel(receipts: ReceiptFact[], items: ItemFact[], rawItems?: RawReceiptItemFact[]): Analytics {
  return buildAnalytics(receipts, items, rawItems);
}
export type ReceiptAllocationRow = {receiptId: number; accountId: string; totalMinor: number};
export function receiptAllocationMatrix(rows: ReceiptAllocationFact[]): ReceiptAllocationRow[] {
  const matrix = new Map<string, ReceiptAllocationRow>(), seen = new Set<string>();
  for (const row of rows) {
    const item = JSON.stringify([row.receiptId, row.itemId]);
    if (seen.has(item) || !Number.isSafeInteger(row.netMinor) || row.netMinor < 0) throw new AccountingError("invalid_receipt_allocation");
    seen.add(item);
    const accountId = row.accountId ?? "expense:unallocated", key = JSON.stringify([row.receiptId, accountId]);
    const value = matrix.get(key) ?? {receiptId: row.receiptId, accountId, totalMinor: 0};
    value.totalMinor += row.netMinor;
    if (!Number.isSafeInteger(value.totalMinor)) throw new AccountingError("invalid_minor_units");
    matrix.set(key, value);
  }
  return [...matrix.values()].sort((a,b)=>a.receiptId-b.receiptId || a.accountId.localeCompare(b.accountId));
}
export function accountingMessage(input: {code: string; messageKey: MessageKey; params: Vars}, locale: Locale): string {
  return translate(locale, input.messageKey, input.params);
}
