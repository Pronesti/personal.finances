import type { ReceiptFact, ItemFact, RawReceiptItemFact } from "../receipts/facts";
import { AccountingError, type Account, type AttributionState, type Journal, type PurchaseVersion, type Currency } from "./model";
import { validDate } from "./journal";
export type { ReceiptFact, ItemFact, RawReceiptItemFact } from "../receipts/facts";
export type ReportFact = {
  id: string; purchaseId: string | null; cardId: string; origin?: "ledger" | "issuer_observation" | "historical_acquisition"; journalId?: string; sourceSection?: string;
  kind: "purchase" | "billing" | "payment" | "credit" | "cost" | "opening";
  description?: string | null; receiptIds?: number[]; installmentNumber?: number | null; installmentCount?: number | null; financed?: boolean; purchaseDate?: string;
  merchant: string | null; accountId: string | null; purposeId: string | null;
  currency: "ARS" | "USD"; minor: number; effectiveDate: string; cycleMonth: string | null;
  sourceLineId: string | null; statementId: string | null; coverage: "complete" | "opening" | "uncertain";
};
export type ReportScope = { basis: "purchase" | "billed"; value: "nominal" | "real" | "usd"; tax: "excl" | "incl"; granularity: "month" | "quarter" | "year" | "all"; period: string | null };
export type SpendRow = { period: string; accountId: string; purposeId: string | null; amount: number };
export type StatementFact = { id: string; cardId: string; sourceRevisionId: string; current: boolean; closingDate: string; previousClosingDate: string | null; dueDate: string | null; cycleMonth: string; balanceArsMinor: number | null; balanceUsdMinor: number | null; previousBalanceArsMinor: number | null; minimumPaymentArsMinor: number | null; purchaseLimitArsMinor: number | null; tnaPct: number | null; temPct: number | null };
export type ScheduleFact = { cardId: string; revisionId: string; current: boolean; month: string; amount: number };
export type ReceiptAllocationFact = { receiptId: number; itemId: string; accountId: string | null; purposeId: string | null; netMinor: number; reviewed: boolean };
export type PurposeMeasureInput = { cardId: string; currency: Currency; from: string; to: string };
export type PurposeMeasure = { purposeId: string | null; expenseMinor: number; debtMinor: number; repaymentMinor: number };
export type PurposeSnapshot = { journals: Journal[]; accounts: Account[]; purchases: PurchaseVersion[]; state: AttributionState };
export type OpeningCoverage = { mode: "historical" | "opening"; cutoffDate: string; unresolvedCount: number; reconciliation: { cardId: string; currency: Currency; issuerDate: string; issuerBilledMinor: number | null; supportedUnbilledMinor?: number; futureScheduleMinor?: number; futureAggregateMinor?: number; unsupportedFutureRemainderMinor?: number; completeFuturePrincipalKnown?: boolean }[] };
export type AccountingInspection = { openingCoverage?: OpeningCoverage; historicalAssociations?: import("./historical-links").HistoricalReceiptAssociation[]; groups?: import("./catalog").AccountGroup[]; merchants?: import("./review").MerchantSubject[]; merchantPurchases?: import("./review").MerchantPurchaseSubject[]; journals: Journal[]; accounts: Account[]; cards: { id: string; displayName: string }[]; sources?: import("./evidence-port").SourceRevision[]; sourceLines?: import("./evidence-port").SourceLine[]; reviews?: import("./evidence-port").ReviewEvent[]; alertStates?: { id: string; state: "open" | "reviewed" | "dismissed"; source?: {kind:string;message:string;expected?:unknown;actual?:unknown;legacyKey?:string} }[] };
export interface AccountingReader {
  inspection(): Promise<AccountingInspection>;
  purposeMeasures?(input: PurposeMeasureInput): Promise<PurposeMeasure[]>;
  facts(): Promise<ReportFact[]>;
  receiptFacts(): Promise<{ receipts: ReceiptFact[]; items: ItemFact[]; rawItems?: RawReceiptItemFact[] }>;
  receiptAllocations(): Promise<ReceiptAllocationFact[]>;
  statements(): Promise<StatementFact[]>;
  schedules(): Promise<ScheduleFact[]>;
  close(): Promise<void>;
}
export class AccountingCapabilityError extends AccountingError {
  constructor(capability: string) { super("accounting_capability_unavailable", { capability }); }
}
export function validateReportFacts(facts: ReportFact[]): ReportFact[] {
  const ids = new Set<string>(), sums = new Map<string,number>();
  for (const fact of facts) {
    if (!fact.id || ids.has(fact.id)) throw new AccountingError("invalid_report_identity");
    ids.add(fact.id);
    if (!Number.isSafeInteger(fact.minor)) throw new AccountingError("invalid_minor_units");
    const key = `${fact.kind}:${fact.currency}`, total = (sums.get(key) ?? 0) + fact.minor;
    if (!Number.isSafeInteger(total)) throw new AccountingError("invalid_minor_units");
    sums.set(key,total);
    if (!validDate(fact.effectiveDate) || fact.cycleMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fact.cycleMonth)) throw new AccountingError("invalid_report_date");
    if (!["ARS", "USD"].includes(fact.currency)) throw new AccountingError("invalid_currency");
  }
  return facts;
}
export async function loadReportFacts(reader: AccountingReader): Promise<ReportFact[]> { return validateReportFacts(await reader.facts()); }
/** Test/read-only fixture adapter; never selected by production composition. */
export function createMemoryReader(input: { facts?: ReportFact[]; receipts?: ReceiptFact[]; items?: ItemFact[]; rawItems?: RawReceiptItemFact[]; allocations?: ReceiptAllocationFact[]; statements?: StatementFact[]; schedules?: ScheduleFact[]; inspection?: AccountingInspection } = {}): AccountingReader {
  const copy = <T>(value: T): T => structuredClone(value);
  const data = copy(input);
  return { inspection: async () => copy(data.inspection ?? { journals: [], accounts: [], cards: [] }), facts: async () => copy(data.facts ?? []), receiptFacts: async () => ({ receipts: copy(data.receipts ?? []), items: copy(data.items ?? []), rawItems: data.rawItems === undefined ? undefined : copy(data.rawItems) }), receiptAllocations: async () => copy(data.allocations ?? []), statements: async () => copy(data.statements ?? []), schedules: async () => copy(data.schedules ?? []), close: async () => {} };
}
