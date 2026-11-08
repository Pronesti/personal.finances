// Backend-owned pure analytical routines ported from the committed reference.
import { buildAnalytics } from "../../receipts/analytics";
import { translate } from "../../i18n";
import { AccountingError } from "../model";
function supermarketModel(receipts, items, rawItems) {
  return buildAnalytics(receipts, items, rawItems);
}
function receiptAllocationMatrix(rows) {
  const matrix = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const item = JSON.stringify([row.receiptId, row.itemId]);
    if (seen.has(item) || !Number.isSafeInteger(row.netMinor) || row.netMinor < 0) throw new AccountingError("invalid_receipt_allocation");
    seen.add(item);
    const accountId = row.accountId ?? "expense:unallocated", key = JSON.stringify([row.receiptId, accountId]);
    const value = matrix.get(key) ?? { receiptId: row.receiptId, accountId, totalMinor: 0 };
    value.totalMinor += row.netMinor;
    if (!Number.isSafeInteger(value.totalMinor)) throw new AccountingError("invalid_minor_units");
    matrix.set(key, value);
  }
  return [...matrix.values()].sort((a, b) => a.receiptId - b.receiptId || a.accountId.localeCompare(b.accountId));
}
function accountingMessage(input, locale) {
  return translate(locale, input.messageKey, input.params);
}
export {
  accountingMessage,
  receiptAllocationMatrix,
  supermarketModel
};
