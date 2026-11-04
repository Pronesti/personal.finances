export type Currency = "ARS" | "USD";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = { id: string; parentId: string | null; type: AccountType; labelKey: string | null; customName: string | null; currency: Currency | null; primaryPurposeId: string | null; posting: boolean; enabled: boolean };
export type Line = { accountId: string; debitMinor: number; creditMinor: number; purchaseId: string | null; purposeId: string | null };
export type Journal = { id: string; commandKey: string; cardId: string; currency: Currency; effectiveDate: string; recordedAt: string; kind: "purchase" | "billing" | "repayment" | "credit" | "cost" | "opening" | "reversal" | "replacement"; reversesId: string | null; evidenceIds: string[]; lines: Line[] };
export type PostResult = { status: "posted" | "duplicate" | "review"; journalIds: string[]; reviewCode: string | null };
export type CommandReceipt = { key: string; digest: string; result: PostResult };
export class AccountingError extends Error {
  constructor(readonly code: string, readonly params: Record<string, string | number> = {}) { super(code); this.name = "AccountingError"; }
}
export type PurchaseInput = { key: string; purchaseId: string; cardId: string; currency: Currency; effectiveDate: string; recordedAt: string; evidenceIds: string[]; principalMinor: number; allocations: { accountId: string; purposeId: string; minor: number }[] };
export type BillingInput = { key: string; purchaseId: string; cardId: string; currency: Currency; installment: number; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[] };
export type PaymentInput = { key: string; cardId: string; currency: Currency; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[]; issuerAllocations: { componentId: string; minor: number }[] | null };
export type PurchaseVersion = PurchaseInput & { version: number; journalId: string };
export type BilledComponent = { id: string; purchaseId: string | null; cardId?: string; purposeId: string | null; currency: Currency; billedDate: string; purchaseDate: string; outstandingMinor: number };
export type Billing = { origin?: "opening_balance" | "opening_installment"; openingObligationId?: string; id: string; purchaseId: string | null; cardId: string; currency: Currency; installment: number; amountMinor: number; effectiveDate: string; purchaseDate: string; journalId: string; components: { id: string; purposeId: string | null; minor: number }[] };
export type Payment = PaymentInput & { id: string; journalId: string; unappliedMinor: number };
export type Attribution = { id: string; paymentId: string; componentId: string; purposeId: string | null; minor: number; method: "issuer" | "oldest_billed_first"; revision: number };
export type LinkedCreditInput = { key: string; purchaseId: string; cardId: string; currency: Currency; amountMinor: number; effectiveDate: string; recordedAt: string; evidenceIds: string[]; billedReductionMinor: number; unbilledReductionMinor: number };
export type LinkedCredit = LinkedCreditInput & { id: string; journalId: string; allocationReductions: { allocationIndex: number; minor: number }[]; componentReductions: { componentId: string; minor: number }[] };
export type CorrectionInput = { key: string; cardId: string; purchaseId: string; expectedVersion: number; replacement: PurchaseInput; recordedAt: string; reason: string };
export type CorrectionLink = { id: string; purchaseId: string; fromVersion: number; toVersion: number; reversalJournalId: string; replacementJournalId: string; reason: string; recordedAt: string };
export type ComponentRevision = { id: string; componentId: string; billingId: string; revision: number; purposeId: string | null; minor: number; purchaseDate: string };
export type AttributionState = { billings: Billing[]; payments: Payment[]; attributions: Attribution[]; credits: LinkedCredit[]; componentRevisions: ComponentRevision[]; attributionRevisions: AttributionRevision[] };
export type CreditRevision = { id: string; creditId: string; purchaseVersion: number; reversalJournalId: string; replacementJournalId: string; recordedAt: string; credit: LinkedCredit };
export type AttributionRevision = { paymentId: string; revision: number; unappliedMinor: number };

/** Supported pre-opening principal; evidence only, never a reconstructed purchase. */
export type OpeningObligation = { id: string; cardId: string; currency: Currency; openingJournalId: string; evidenceIds: string[]; originalPrincipalMinor: number; alreadyBilledMinor: number; remainingMinor: number; purchaseDate: string; lastBilledInstallment: number; installmentCount: number; allocations: { purposeId: string | null; minor: number }[] };
export type OpeningBillingInput = Omit<BillingInput, "purchaseId"> & { openingObligationId: string };
