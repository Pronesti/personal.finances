import type { ReviewTx } from "./review";
import type { CatalogTx } from "./catalog-service";
import type { EvidenceTx } from "./evidence-port";
import type { Account, CommandReceipt, Journal, PurchaseVersion, Billing, BilledComponent, Currency, Payment, Attribution, LinkedCredit, CorrectionLink, ComponentRevision, AttributionState, CreditRevision, AttributionRevision } from "./model";
export interface LedgerTx extends EvidenceTx, CatalogTx, ReviewTx {
  openingObligation(id: string): Promise<import("./model").OpeningObligation | null>;
  openingObligations(cardId: string, currency: Currency): Promise<import("./model").OpeningObligation[]>;
  appendOpeningObligation(obligation: import("./model").OpeningObligation): Promise<void>;
  openingBillings(id: string): Promise<Billing[]>;
  openingDate(cardId: string, currency: Currency): Promise<string | null>;
  journal(id: string): Promise<Journal | null>;
  appendAttributionRevision(revision: AttributionRevision): Promise<void>;
  appendCreditRevision(revision: CreditRevision): Promise<void>;
  appendCorrection(link: CorrectionLink): Promise<void>;
  appendComponentRevisions(rows: ComponentRevision[]): Promise<void>;
  attributionState(cardId: string, currency: Currency): Promise<AttributionState>;
  command(key: string): Promise<CommandReceipt | null>;
  account(id: string): Promise<Account | null>;
  hasChildAccounts(id: string): Promise<boolean>;
  appendJournal(journal: Journal): Promise<void>;
  appendCommand(receipt: CommandReceipt): Promise<void>;
  purchase(id: string): Promise<PurchaseVersion | null>;
  appendPurchase(version: PurchaseVersion): Promise<void>;
  billings(purchaseId: string): Promise<Billing[]>;
  appendBilling(billing: Billing): Promise<void>;
  billedComponents(currency: Currency, cardId: string): Promise<BilledComponent[]>;
  appendPayment(payment: Payment): Promise<void>;
  appendAttributions(rows: Attribution[]): Promise<void>;
  linkedCredits(purchaseId: string): Promise<LinkedCredit[]>;
  appendLinkedCredit(credit: LinkedCredit): Promise<void>;
}
export interface LedgerPort {
  transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T>;
  journals(cardId: string): Promise<Journal[]>;
}
