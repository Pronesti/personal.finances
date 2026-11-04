import type {HistoricalLinksTx} from "./historical-links";
import type { Currency } from "./model";
import type { LedgerPort, LedgerTx } from "./port";
import type { ParsedReceipt } from "@/lib/receipts/parse";
import type { VerificationReport } from "@/lib/receipts/verify";
import type { DocumentRef } from "./documents";
import type { PurchaseIdentity, SourceRevisionInput } from "./evidence";

export type SourceObject = DocumentRef & { byteLength: number };
export type SourceRevision = SourceRevisionInput & {
  id: string; payloadDigest: string; sourceKey: string; rawObject: DocumentRef | null; appRevision: string;
  admission: "accepted" | "rejected" | "pending";
};
export type SourceLine = { id: string; revisionId: string; occurrence: number; payload: Record<string, unknown>; legacyFingerprint: string | null };
export type ImportReview = { code: string; params: Record<string, string | number>; sourceLineIds: string[] };
export type ReviewEvent = ImportReview & { id: string; subjectId: string; priorDecisionId: string | null; state: "open" | "reviewed" | "dismissed"; recordedAt: string };
export type ImportResult = { sourceRevisionId: string; purchaseIds: string[]; postedJournalIds: string[]; reviews: ImportReview[]; duplicate: boolean };
export type SourceImportCommand = { key: string; digest: string; result: ImportResult };
export type StatementFacts = { revisionId: string; cardId: string; closingDate: string; period: unknown; terms: unknown; schedules: unknown[] };
export type ReceiptFacts = {
  revisionId: string; receiptId: number; chain: string; fiscalId: string | null; date: string | null; totalMinor: number | null;
  parsed: ParsedReceipt; report: VerificationReport; scale: number;
  originalRowsObject: DocumentRef; correctedRowsObject: DocumentRef | null; productReviewed: false;
};
export type ReceiptLinkDecision = {
  id: string; key: string; receiptRevisionId: string; purchaseId: string | null; cardId: string | null;
  paymentVerified: boolean; action: "link" | "unlink"; recordedAt: string; previousDecisionId: string | null;
  allocation: { accountId: string; purposeId: string; minor: number }[] | null;
  itemAllocations: {sourceLineId:string;accountId:string;purposeId:string;minor:number}[];
};
export interface EvidenceTx extends HistoricalLinksTx {
  sourceObject(hash: string): Promise<SourceObject | null>;
  appendSourceObject(object: SourceObject): Promise<void>;
  sourceRevision(id: string): Promise<SourceRevision | null>;
  sourceRevisions(sourceKey: string): Promise<SourceRevision[]>;
  sourceByDocument(kind: "statement" | "receipt", hash: string, payloadDigest?: string): Promise<SourceRevision | null>;
  appendSourceRevision(revision: SourceRevision): Promise<void>;
  sourceLine(id: string): Promise<SourceLine | null>;
  sourceLines(revisionId: string): Promise<SourceLine[]>;
  appendSourceLine(line: SourceLine): Promise<void>;
  statementSourceLines(cardId: string | null): Promise<{revision:SourceRevision;line:SourceLine}[]>;
  statementFacts(revisionId: string): Promise<StatementFacts | null>;
  currentStatementRevision(cardId: string, closingDate?: string): Promise<SourceRevision | null>;
  appendStatementFacts(facts: StatementFacts): Promise<void>;
  reviewEvents(subjectId: string): Promise<ReviewEvent[]>;
  appendReviewEvent(event: ReviewEvent): Promise<void>;
  purchaseIdentities(cardId: string, currency: Currency, purchaseDate: string): Promise<PurchaseIdentity[]>;
  appendPurchaseIdentity(identity: PurchaseIdentity): Promise<void>;
  allPurchaseIdentities(): Promise<PurchaseIdentity[]>;
  ensureReceiptEntity(chain: string, fiscalId: string | null, documentHash: string, previousReceiptId?: number): Promise<number>;
  receiptFacts(revisionId: string): Promise<ReceiptFacts | null>;
  appendReceiptFacts(facts: ReceiptFacts): Promise<void>;
  acceptedReceipts(): Promise<ReceiptFacts[]>;
  receiptLinkDecisions(receiptRevisionId: string): Promise<ReceiptLinkDecision[]>;
  allReceiptLinkDecisions(): Promise<ReceiptLinkDecision[]>;
  appendReceiptLinkDecision(decision: ReceiptLinkDecision): Promise<void>;
  sourceImportCommand(key: string): Promise<SourceImportCommand | null>;
  appendSourceImportCommand(command: SourceImportCommand): Promise<void>;
}
export type EvidenceLedgerTx = LedgerTx & EvidenceTx;
export interface EvidenceLedgerPort extends LedgerPort {
  transaction<T>(work: (tx: EvidenceLedgerTx) => Promise<T>): Promise<T>;
}
