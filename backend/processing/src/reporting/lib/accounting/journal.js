// Backend-owned pure analytical routines ported from the committed reference.
import { AccountingError } from "./model";
function exactMinor(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new AccountingError("invalid_minor_units");
  return n;
}
function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function qualifiedCommandKey(cardId, key) {
  return `card:${encodeURIComponent(cardId)}:${encodeURIComponent(key)}`;
}
function validateJournal(j) {
  if (![j.id, j.commandKey, j.cardId].every((v) => typeof v === "string" && v.trim().length)) throw new AccountingError("invalid_identity");
  if (j.currency !== "ARS" && j.currency !== "USD") throw new AccountingError("invalid_currency");
  if (!validDate(j.effectiveDate) || !validDate(j.recordedAt.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(j.recordedAt) || !Number.isFinite(Date.parse(j.recordedAt))) throw new AccountingError("invalid_date");
  if (!["purchase", "billing", "repayment", "credit", "cost", "opening", "reversal", "replacement"].includes(j.kind)) throw new AccountingError("invalid_journal_kind");
  if (!j.evidenceIds.length || j.evidenceIds.some((id) => !id.trim()) || new Set(j.evidenceIds).size !== j.evidenceIds.length) throw new AccountingError("missing_evidence");
  if (j.lines.length < 2) throw new AccountingError("unbalanced_journal");
  let debit = 0, credit = 0;
  for (const line of j.lines) {
    exactMinor(line.debitMinor);
    exactMinor(line.creditMinor);
    if (!line.accountId || line.debitMinor > 0 === line.creditMinor > 0) throw new AccountingError("invalid_journal_line");
    debit = exactMinor(debit + line.debitMinor);
    credit = exactMinor(credit + line.creditMinor);
  }
  if (!debit || debit !== credit) throw new AccountingError("unbalanced_journal");
}
function journalCommandPayload(j) {
  return JSON.stringify({ cardId: j.cardId, currency: j.currency, effectiveDate: j.effectiveDate, kind: j.kind, reversesId: j.reversesId, evidenceIds: [...j.evidenceIds].sort(), lines: j.lines.map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor, purchaseId: l.purchaseId, purposeId: l.purposeId })) });
}
export {
  exactMinor,
  journalCommandPayload,
  qualifiedCommandKey,
  validDate,
  validateJournal
};
