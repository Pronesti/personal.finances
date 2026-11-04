import { normalizeMerchant } from "../categorize";
import { sourceAmountMinor } from "./evidence";
import type { SourceLine, SourceRevision, ReviewEvent, ReceiptFacts } from "./evidence-port";
import type { HistoricalReceiptAssociation } from "./historical-links";
import { validDate } from "./journal";
import { AccountingError, type Account, type Journal } from "./model";
import { ordinaryPurchaseNature } from "./purchase-nature";
import type { ReportFact, StatementFact } from "./read-model";

export function eligibleHistoricalSource(line: SourceLine, revision: Pick<SourceRevision, "id" | "kind" | "admission" | "cardId" | "closingDate">, openingDate: string | null, supportedReceiptPrincipalMinor?: number): { currency: "ARS" | "USD"; minor: number; effectiveDate: string } | null {
  if (!openingDate || revision.kind !== "statement" || revision.admission !== "accepted" || !revision.cardId || revision.id !== line.revisionId || !revision.closingDate || revision.closingDate > openingDate) return null;
  const payload = line.payload;
  if (payload.section !== "purchases" || typeof payload.date !== "string" || !validDate(payload.date) || payload.date > openingDate || typeof payload.description !== "string" || !ordinaryPurchaseNature(payload.description)) return null;
  const financed = typeof payload.installment_count === "number" && Number.isSafeInteger(payload.installment_count) && payload.installment_count > 1;
  const receiptPrincipal = financed && payload.installment_number === 1 && typeof supportedReceiptPrincipalMinor === "number" && Number.isSafeInteger(supportedReceiptPrincipalMinor) && supportedReceiptPrincipalMinor > 0;
  if (!receiptPrincipal && (payload.installment_count != null && payload.installment_count !== 1 || payload.installment_number != null && payload.installment_number !== 1)) return null;
  const values = (["ars", "usd"] as const).filter(field => typeof payload[field] === "number" && payload[field] !== 0);
  if (values.length !== 1) return null;
  const field = values[0], value = payload[field] as number;
  if (value <= 0) return null;
  if (receiptPrincipal && field !== "ars") return null;
  return { currency: field === "ars" ? "ARS" : "USD", minor: receiptPrincipal ? supportedReceiptPrincipalMinor! : sourceAmountMinor(value), effectiveDate: payload.date };
}

/** A verified original receipt can establish financed acquisition cost, without multiplying bills. */
export function receiptBackedHistoricalAcquisitions(backed: ReportFact[], associations: HistoricalReceiptAssociation[], receipts: ReceiptFacts[], statements: StatementFact[], lines: SourceLine[], journals: Journal[]): ReportFact[] {
  const result: ReportFact[] = [];
  for (const association of associations) {
    const receipt = receipts.find(receipt => receipt.revisionId === association.receiptRevisionId);
    const line = lines.find(line => line.id === association.sourceLineId);
    const statement = line && statements.find(statement => statement.current && statement.id === line.revisionId);
    if (!receipt?.report.ok || !receipt.date || !receipt.totalMinor || !line || !statement || !(typeof line.payload.installment_count === "number" && line.payload.installment_count > 1)) continue;
    if (backed.some(fact => fact.kind === "purchase" && (fact.sourceLineId === line.id || fact.receiptIds?.includes(receipt.receiptId)))) continue;
    const opening = journals.filter(journal => journal.kind === "opening" && journal.cardId === statement.cardId).map(journal => journal.effectiveDate).sort()[0];
    if (!opening || receipt.date > opening) continue;
    const eligible = eligibleHistoricalSource(line, { id: statement.id, kind: "statement", admission: "accepted", cardId: statement.cardId, closingDate: statement.closingDate }, opening, receipt.totalMinor);
    if (!eligible) continue;
    result.push({ id: `historical-receipt-acquisition:${receipt.receiptId}`, purchaseId: null, origin: "historical_acquisition", kind: "purchase", cardId: statement.cardId, merchant: normalizeMerchant(String(line.payload.description)), description: String(line.payload.description), accountId: "expense:unallocated", purposeId: "unallocated", currency: eligible.currency, minor: eligible.minor, effectiveDate: receipt.date, purchaseDate: receipt.date, cycleMonth: statement.cycleMonth, statementId: statement.id, sourceLineId: line.id, receiptIds: [receipt.receiptId], coverage: "complete", financed: true, installmentNumber: 1, installmentCount: line.payload.installment_count as number });
  }
  return result;
}

/** Acquisition evidence before the opening books; never creates a financial entry. */
export function historicalAcquisitionFacts(backed: ReportFact[], statements: StatementFact[], lines: SourceLine[], journals: Journal[]): ReportFact[] {
  const result: ReportFact[] = [];
  for (const line of lines) {
    const statement = statements.find(source => source.current && source.id === line.revisionId);
    if (!statement) continue;
    const payload = line.payload;
    const values = (["ars", "usd"] as const).filter(field => typeof payload[field] === "number" && payload[field] !== 0);
    if (values.length !== 1) continue;
    const field = values[0];
    const currency = field === "ars" ? "ARS" : "USD";
    const opening = journals.filter(journal => journal.kind === "opening" && journal.cardId === statement.cardId && journal.currency === currency).map(journal => journal.effectiveDate).sort()[0] ?? journals.filter(journal => journal.kind === "opening" && journal.cardId === statement.cardId).map(journal => journal.effectiveDate).sort()[0];
    const eligible = eligibleHistoricalSource(line, { id: statement.id, kind: "statement", admission: "accepted", cardId: statement.cardId, closingDate: statement.closingDate }, opening ?? null);
    if (!eligible) continue;
    if (backed.some(fact => fact.sourceLineId === line.id && fact.currency === currency && (fact.kind === "purchase" || fact.purchaseId !== null))) continue;
    result.push({ id: `historical-acquisition:${line.id}:${currency}`, purchaseId: null, cardId: statement.cardId, origin: "historical_acquisition", kind: "purchase", description: payload.description as string, merchant: normalizeMerchant(payload.description as string), accountId: "expense:unallocated", purposeId: "unallocated", currency, minor: eligible.minor, effectiveDate: eligible.effectiveDate, cycleMonth: statement.cycleMonth, sourceLineId: line.id, statementId: statement.id, coverage: "complete", financed: false, purchaseDate: eligible.effectiveDate });
  }
  return result;
}

/** Explicit source-only decisions never reclassify the opening books. Input is append order. */
export function applyHistoricalClassifications(facts: ReportFact[], events: ReviewEvent[], accounts: Account[]): void {
  const latest = new Map<string, ReviewEvent>();
  for (const event of events) if (event.code === "historical_source_classification") latest.set(event.subjectId, event);
  for (const fact of facts) {
    if (fact.origin !== "historical_acquisition" || !fact.sourceLineId) continue;
    const event = latest.get(fact.sourceLineId);
    if (!event || event.state !== "reviewed") continue;
    const account = accounts.find(account => account.id === event.params.accountId);
    if (!account || !account.posting || accounts.some(child => child.parentId === account.id) || !["expense", "asset"].includes(account.type) || typeof event.params.purposeId !== "string") throw new AccountingError("invalid_historical_classification");
    fact.accountId = account.id;
    fact.purposeId = event.params.purposeId;
  }
}
