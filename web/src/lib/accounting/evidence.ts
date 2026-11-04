import { createHash } from "node:crypto";
import { AccountingError, type Currency } from "./model";
import { exactMinor, validDate } from "./journal";

export type SourceRevisionInput = {
  key: string; cardId: string | null; kind: "statement" | "receipt";
  documentHash: string; objectPath: string; rawPayload: unknown;
  previousRevisionId: string | null; recordedAt: string;
  fiscalId: string | null; closingDate: string | null;
};
export type PurchaseIdentityInput = {
  cardId: string; currency: Currency; purchaseDate: string; voucher: string | null;
  installment: number | null; installmentCount: number | null;
  amountMinor: number; sourceLineId: string;
};
export type PurchaseIdentity = PurchaseIdentityInput & { purchaseId: string };
export type IdentityDecision = { status: "matched" | "new" | "review"; purchaseId: string | null; reason: string };

/** Cycle/fiscal identity groups revisions; document-hash uniqueness is a separate invariant. */
export function sourceKey(input: Pick<SourceRevisionInput, "cardId" | "kind" | "documentHash" | "fiscalId" | "closingDate">): string {
  if (!/^[a-f0-9]{64}$/.test(input.documentHash)) throw new AccountingError("invalid_document_hash");
  if (input.kind === "statement") {
    if (!input.cardId?.trim()) throw new AccountingError("missing_card_identity");
    if (!input.closingDate || !validDate(input.closingDate)) throw new AccountingError("invalid_date");
    return JSON.stringify(["statement", input.cardId, input.closingDate]);
  }
  if (input.kind !== "receipt") throw new AccountingError("invalid_source_kind");
  if (input.fiscalId !== null) {
    if (!/^[^:\s]+:\S(?:.*\S)?$/.test(input.fiscalId)) throw new AccountingError("invalid_fiscal_identity");
    return JSON.stringify(["receipt", "fiscal", input.fiscalId]);
  }
  return JSON.stringify(["receipt", "sha256", input.documentHash]);
}

export function sourceLineId(revisionId: string, occurrence: number): string {
  if (!revisionId.trim()) throw new AccountingError("invalid_source_revision");
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) throw new AccountingError("invalid_source_occurrence");
  return JSON.stringify([revisionId, occurrence]);
}

function validateIdentity(input: PurchaseIdentityInput): void {
  if (!input.cardId.trim() || !input.sourceLineId.trim() || input.voucher !== null && !input.voucher.trim()) throw new AccountingError("invalid_identity");
  if (input.currency !== "ARS" && input.currency !== "USD") throw new AccountingError("invalid_currency");
  if (!validDate(input.purchaseDate)) throw new AccountingError("invalid_date");
  exactMinor(input.amountMinor);
  if (!input.amountMinor) throw new AccountingError("invalid_minor_units");
  const { installment: n, installmentCount: count } = input;
  if ((n === null) !== (count === null) || n !== null && (!Number.isSafeInteger(n) || !Number.isSafeInteger(count) || n < 1 || count! < n)) throw new AccountingError("invalid_installment_identity");
}
const review = (reason: string): IdentityDecision => ({ status: "review", purchaseId: null, reason });
const matched = (purchaseId: string, reason: string): IdentityDecision => ({ status: "matched", purchaseId, reason });

/** Equal amounts and installment arithmetic only corroborate identity; neither proves it. */
export function identifyPurchase(input: PurchaseIdentityInput, candidates: PurchaseIdentity[]): IdentityDecision {
  validateIdentity(input);
  candidates.forEach(c => { validateIdentity(c); if (!c.purchaseId.trim()) throw new AccountingError("invalid_identity"); });
  const exact = candidates.filter(c => c.sourceLineId === input.sourceLineId);
  if (exact.some(c => c.cardId !== input.cardId || c.currency !== input.currency)) return review("source_line_conflict");
  const eligible = candidates.filter(c => c.cardId === input.cardId && c.currency === input.currency);
  if (exact.length) {
    if (exact.some(c => c.purchaseDate !== input.purchaseDate || c.amountMinor !== input.amountMinor || c.voucher !== input.voucher || c.installment !== input.installment || c.installmentCount !== input.installmentCount)) return review("source_line_conflict");
    const ids = new Set(exact.map(c => c.purchaseId));
    return ids.size === 1 ? matched(exact[0].purchaseId, "same_source_line") : review("multiple_purchase_candidates");
  }
  const vouchers = input.voucher === null ? [] : eligible.filter(c => c.voucher === input.voucher && c.purchaseDate === input.purchaseDate && !distinctOccurrences(input.sourceLineId,c.sourceLineId));
  if (vouchers.length) {
    if (vouchers.some(c => c.amountMinor !== input.amountMinor || c.installmentCount !== input.installmentCount || c.installment !== input.installment && (c.installment === null || input.installment === null || c.installment >= input.installment))) return review("voucher_facts_conflict");
    return new Set(vouchers.map(c => c.purchaseId)).size === 1 ? matched(vouchers[0].purchaseId, "same_voucher") : review("multiple_purchase_candidates");
  }
  if (input.installment !== null && input.installment > 1) return review("missing_installment_history");
  if (eligible.some(c => c.purchaseDate === input.purchaseDate && c.amountMinor === input.amountMinor
    && (input.voucher === null || c.voucher === null) && !distinctOccurrences(input.sourceLineId, c.sourceLineId))) return review("insufficient_identity_evidence");
  return { status: "new", purchaseId: null, reason: "distinct_source_line" };
}

/** Distinct printed rows on the same revision are distinct occurrences, even if amounts repeat. */
function distinctOccurrences(left: string, right: string): boolean {
  try {
    const a: unknown = JSON.parse(left), b: unknown = JSON.parse(right);
    const occurrence = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isSafeInteger(v[1]) && v[1] > 0;
    return occurrence(a) && occurrence(b) && a[0] === b[0] && a[1] !== b[1];
  } catch { return false; }
}


/** Retain append-only evidence inside the caller's financial transaction. */
export async function retainSourceTx(
  tx: import("./evidence-port").EvidenceTx,
  input: SourceRevisionInput & { rawObject?: import("./documents").DocumentRef | null; appRevision: string; admission?: "accepted" | "rejected" | "pending" },
): Promise<{ revisionId: string; status: "new" | "duplicate" | "revision" }> {
  const key = sourceKey(input);
  if (!input.key.trim() || !input.appRevision.trim()) throw new AccountingError("invalid_source_metadata");
  if (!validDate(input.recordedAt.slice(0,10)) || !Number.isFinite(Date.parse(input.recordedAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt)) throw new AccountingError("invalid_date");
  const source = await tx.sourceObject(input.documentHash);
  if (!source || source.relativePath !== input.objectPath) throw new AccountingError("missing_source_object");
  if (input.rawObject) {
    const raw = await tx.sourceObject(input.rawObject.sha256);
    if (!raw || raw.relativePath !== input.rawObject.relativePath) throw new AccountingError("missing_source_object");
  }
  const payloadDigest = sourcePayloadDigest(input.rawPayload);
  const duplicate = await tx.sourceByDocument(input.kind,input.documentHash,payloadDigest);
  if (duplicate) {
    if (duplicate.sourceKey !== key) throw new AccountingError("document_identity_conflict");
    return { revisionId: duplicate.id, status: "duplicate" };
  }
  const revisions = await tx.sourceRevisions(key);
  let latest = revisions.find(r => !revisions.some(child => child.previousRevisionId === r.id));
  if (input.previousRevisionId !== null && input.previousRevisionId !== latest?.id) {
    const prior = await tx.sourceRevision(input.previousRevisionId);
    // Correcting a missing fiscal ID may refine the identity of a rejected scan.
    if (!latest && prior?.kind===input.kind && prior.documentHash===input.documentHash && (input.kind==="receipt" && prior.admission==="rejected" || input.kind==="statement" && prior.cardId===input.cardId && input.admission==="pending")) latest=prior;
    else throw new AccountingError("stale_source_revision");
  }
  const id = `source:${input.kind}:${input.documentHash}:${payloadDigest}`;
  await tx.appendSourceRevision({ ...input, id, payloadDigest, sourceKey: key, previousRevisionId: latest?.id ?? null, rawObject: input.rawObject ?? null, admission: input.admission ?? (latest ? "pending" : "accepted") });
  return { revisionId: id, status: latest ? "revision" : "new" };
}
export async function retainSource(
  port: import("./evidence-port").EvidenceLedgerPort,
  input: SourceRevisionInput & { rawObject?: import("./documents").DocumentRef | null; appRevision: string; admission?: "accepted" | "rejected" | "pending" },
): Promise<{ revisionId: string; status: "new" | "duplicate" | "revision" }> {
  return port.transaction(tx => retainSourceTx(tx,input));
}

export function sourcePayloadDigest(payload: unknown): string {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,order(v)])) : v;
  const normalized = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? { ...payload as Record<string,unknown>, file: null } : payload;
  const encoded = JSON.stringify(order(normalized));
  if (encoded === undefined) throw new AccountingError("invalid_source_payload");
  return createHash("sha256").update(encoded).digest("hex");
}

/** Convert a printed decimal amount to signed cents without accepting fractional cents. */
export function sourceAmountMinor(amount: number): number {
  if (!Number.isFinite(amount)) throw new AccountingError("invalid_source_amount");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) throw new AccountingError("invalid_source_amount");
  const cents = (BigInt(match[2])*BigInt(100)+BigInt((match[3]??"").padEnd(2,"0")))*(match[1]?BigInt(-1):BigInt(1));
  const result=Number(cents);
  if (!Number.isSafeInteger(result)) throw new AccountingError("invalid_source_amount");
  return result;
}
