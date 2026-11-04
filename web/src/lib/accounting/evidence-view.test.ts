import { expect, it } from "vitest";
import { evidenceRouteId, evidenceView } from "./evidence-view";
import { createMemoryLedger } from "./memory";
import { syntheticSeed } from "./test-support";
import { createMemoryDocuments } from "./documents";
import { importStatement } from "./statement-import";
import { postJournal } from "./use-cases";

it("decodes actual encoded line IDs once, retaining opaque identity and rejecting malformed input", () => {
  const id = JSON.stringify(["source:statement:synthetic", 4]);
  expect(evidenceRouteId(encodeURIComponent(id))).toBe(id);
  expect(evidenceRouteId(id)).toBe(id);
  expect(evidenceRouteId("%not-a-valid-escape")).toBeNull();
  expect(evidenceRouteId("x".repeat(1025))).toBeNull();
});

it("opens source lines and the exact issuer document behind an opening even after a newer statement arrives", async () => {
  const ledger = createMemoryLedger(syntheticSeed()), documents = createMemoryDocuments();
  const importCycle = async (date: string) => {
    const json = { file: `synthetic_${date}.pdf`, brand: "visa", period: { closing_date: date }, transactions: [] };
    return importStatement(ledger, documents, { key: date, cardId: "card-a", filename: json.file, pdf: Buffer.from(`%PDF-${date}`), json, rawJson: Buffer.from(JSON.stringify(json)), recordedAt: "2026-10-03T12:00:00Z", appRevision: "synthetic:evidence-view", observationOnly: true });
  };
  const original = await importCycle("2026-09-01");
  await postJournal(ledger, { id: "synthetic:e1", commandKey: "opening", cardId: "card-a", currency: "ARS", effectiveDate: "2026-09-01", recordedAt: "2026-10-02T12:00:00Z", kind: "opening", reversesId: null, evidenceIds: ["synthetic:e1"], lines: [{ accountId: "equity:opening", debitMinor: 8000, creditMinor: 0, purchaseId: null, purposeId: null }, { accountId: "card-a:ARS:billed", debitMinor: 0, creditMinor: 8000, purchaseId: null, purposeId: null }] }, "opening-digest");
  await importCycle("2026-10-01");
  expect((await ledger.transaction(tx => evidenceView(tx, "synthetic:e1")))?.revision.id).toBe(original.sourceRevisionId);
  expect(await ledger.transaction(tx => evidenceView(tx, "missing"))).toBeNull();
});
