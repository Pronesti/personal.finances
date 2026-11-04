import { describe, expect, it } from "vitest";
import { identifyPurchase, sourceKey, sourceLineId, type PurchaseIdentityInput } from "./evidence";
const hash = "a".repeat(64);
const line: PurchaseIdentityInput = { cardId: "card-a", currency: "ARS", purchaseDate: "2026-01-15", voucher: null, installment: null, installmentCount: null, amountMinor: 10000, sourceLineId: "revision-a:1" };
const candidate = (purchaseId: string, overrides: Partial<PurchaseIdentityInput> = {}) => ({ ...line, sourceLineId: "other:1", purchaseId, ...overrides });

describe("source identities", () => {
  it("qualifies statement cycles by actual card and retains the key across revised bytes", () => {
    const input = { cardId: "card-a", kind: "statement" as const, documentHash: hash, fiscalId: null, closingDate: "2026-01-31" };
    expect(sourceKey(input)).toBe(sourceKey({ ...input, documentHash: "b".repeat(64) }));
    expect(sourceKey(input)).not.toBe(sourceKey({ ...input, cardId: "card-b" }));
    expect(() => sourceKey({ ...input, cardId: null })).toThrow("missing_card_identity");
  });
  it("identifies receipts before a card is known by chain-qualified fiscal ID or bytes", () => {
    const input = { cardId: null, kind: "receipt" as const, documentHash: hash, fiscalId: "coto:123", closingDate: null };
    expect(sourceKey(input)).toBe(sourceKey({ ...input, cardId: "card-a", documentHash: "b".repeat(64) }));
    expect(sourceKey(input)).not.toBe(sourceKey({ ...input, fiscalId: "other:123" }));
    expect(sourceKey({ ...input, fiscalId: null })).not.toBe(sourceKey({ ...input, fiscalId: null, documentHash: "b".repeat(64) }));
    expect(() => sourceKey({ ...input, fiscalId: "123" })).toThrow("invalid_fiscal_identity");
  });
  it("requires source hashes and distinct stable revision/occurrence IDs", () => {
    expect(() => sourceKey({ cardId: null, kind: "receipt", documentHash: "", fiscalId: null, closingDate: null })).toThrow("invalid_document_hash");
    expect(sourceLineId("revision-a", 1)).not.toBe(sourceLineId("revision-a", 2));
    expect(sourceLineId("revision-a", 1)).not.toBe(sourceLineId("revision-b", 1));
    expect(sourceLineId("revision-a", 1)).toBe(sourceLineId("revision-a", 1));
    expect(() => sourceLineId("revision-a", 0)).toThrow("invalid_source_occurrence");
  });
});

describe("identifyPurchase", () => {
  it("does not collapse equal same-day purchases without distinguishing evidence", () => {
    const input = { ...line, installment: 2, installmentCount: 6 };
    expect(identifyPurchase(input, [candidate("p1", { installment: 1, installmentCount: 6 }), candidate("p2", { installment: 1, installmentCount: 6 })]).status).toBe("review");
    expect(identifyPurchase(line, [candidate("p1")]).status).toBe("review");
    expect(identifyPurchase(line, [])).toMatchObject({ status: "new", purchaseId: null });
  });
  it("matches an unchanged source line and flags changed facts", () => {
    const old = candidate("p1", { sourceLineId: line.sourceLineId });
    expect(identifyPurchase(line, [old])).toMatchObject({ status: "matched", purchaseId: "p1" });
    expect(identifyPurchase({ ...line, amountMinor: 10001 }, [old])).toMatchObject({ status: "review", reason: "source_line_conflict" });
  });
  it("requires voucher/card/currency/date proof and installment corroboration", () => {
    const input = { ...line, voucher: "voucher-1", installment: 2, installmentCount: 6 };
    const old = candidate("p1", { voucher: "voucher-1", installment: 1, installmentCount: 6 });
    expect(identifyPurchase(input, [old])).toMatchObject({ status: "matched", purchaseId: "p1" });
    expect(identifyPurchase(input, [{ ...old, cardId: "card-b" }])).toMatchObject({ status: "review", reason: "missing_installment_history" });
    expect(identifyPurchase(input, [{ ...old, currency: "USD" }])).toMatchObject({ status: "review", reason: "missing_installment_history" });
    expect(identifyPurchase(input, [{ ...old, amountMinor: 9999 }])).toMatchObject({ status: "review", reason: "voucher_facts_conflict" });
  });
  it("never invents original principal or resolves multiple voucher candidates", () => {
    expect(identifyPurchase({ ...line, installment: 3, installmentCount: 6 }, [])).toMatchObject({ status: "review", reason: "missing_installment_history" });
    expect(identifyPurchase({ ...line, voucher: "v" }, [candidate("p1", { voucher: "v" }), candidate("p2", { voucher: "v" })])).toMatchObject({ status: "review", reason: "multiple_purchase_candidates" });
    expect(identifyPurchase({ ...line, cardId: "card-b" }, [candidate("p1")]).status).toBe("new");
  });
  it("keeps explicit distinct voucher and same-document row occurrences separate", () => {
    expect(identifyPurchase({ ...line, voucher: "second" }, [candidate("p1", { voucher: "first" })]).status).toBe("new");
    const input = { ...line, sourceLineId: sourceLineId("revision-a", 2) };
    expect(identifyPurchase(input, [candidate("p1", { sourceLineId: sourceLineId("revision-a", 1) })]).status).toBe("new");
    expect(identifyPurchase({ ...line, cardId: "other" }, [candidate("p1", { sourceLineId: line.sourceLineId })])).toMatchObject({ status: "review", reason: "source_line_conflict" });
  });
  it("rejects invalid exact amounts, dates and installment evidence", () => {
    expect(() => identifyPurchase({ ...line, amountMinor: 1.5 }, [])).toThrow("invalid_minor_units");
    expect(() => identifyPurchase({ ...line, purchaseDate: "2026-02-30" }, [])).toThrow("invalid_date");
    expect(() => identifyPurchase({ ...line, installment: 7, installmentCount: 6 }, [])).toThrow("invalid_installment_identity");
  });
});
