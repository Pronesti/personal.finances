import { expect, it } from "vitest";
import { historicalAcquisitionFacts, receiptBackedHistoricalAcquisitions } from "./historical-analytics";
import { receiptExtraction } from "./receipt-test-support";
import type { ReceiptFacts } from "./evidence-port";
import type { HistoricalReceiptAssociation } from "./historical-links";
import { issuerObservationFacts } from "./reader-postgres";
import { spendRows } from "./reports/spending";
import type { SourceLine } from "./evidence-port";
import type { Journal } from "./model";
import type { StatementFact } from "./read-model";

const statement: StatementFact = { id: "statement", sourceRevisionId: "statement", cardId: "card-a", current: true, closingDate: "2026-10-01", previousClosingDate: null, dueDate: null, cycleMonth: "2026-09", balanceArsMinor: 8000, balanceUsdMinor: null, previousBalanceArsMinor: null, minimumPaymentArsMinor: null, purchaseLimitArsMinor: null, tnaPct: null, temPct: null };
const opening: Journal = { id: "opening", commandKey: "opening", cardId: "card-a", currency: "ARS", effectiveDate: "2026-10-01", recordedAt: "2026-10-02T12:00:00Z", kind: "opening", reversesId: null, evidenceIds: ["opening-proof"], lines: [{ accountId: "equity:opening", debitMinor: 8000, creditMinor: 0, purchaseId: null, purposeId: null }, { accountId: "card-a:ARS:billed", debitMinor: 0, creditMinor: 8000, purchaseId: null, purposeId: null }] };
const line: SourceLine = { id: "source-line", revisionId: "statement", occurrence: 1, legacyFingerprint: null, payload: { section: "purchases", date: "2026-09-15", description: "SYNTHETIC SHOP", ars: 80, usd: null, installment_number: null, installment_count: null } };

it("retains supported pre-opening acquisitions in analytics while opening books contain no fabricated expense", () => {
  const journals = structuredClone([opening]);
  const billed = issuerObservationFacts([], [statement], [line]);
  const historical = historicalAcquisitionFacts(billed, [statement], [line], journals);
  expect(historical).toMatchObject([{ kind: "purchase", origin: "historical_acquisition", minor: 8000, effectiveDate: "2026-09-15", sourceLineId: line.id, purchaseId: null }]);
  const scope = { basis: "purchase" as const, value: "nominal" as const, tax: "excl" as const, granularity: "month" as const, period: null };
  expect(spendRows([...billed, ...historical], scope, { cpi: {}, mep: {} }).reduce((sum, row) => sum + row.amount, 0)).toBe(80);
  expect(spendRows([...billed, ...historical], { ...scope, basis: "billed" }, { cpi: {}, mep: {} }).reduce((sum, row) => sum + row.amount, 0)).toBe(80);
  expect(journals).toEqual([opening]);
  expect(journals.some(journal => journal.lines.some(entry => entry.accountId.startsWith("expense:")))).toBe(false);
});

it("does not reconstruct financing principal, ambiguous financial nature or two native purchase columns", () => {
  const variations = [
    { installment_count: 6, installment_number: 1 },
    { installment_count: null, installment_number: 3 },
    { description: "PLAN OVALO" },
    { description: "PRESTAMO" },
    { usd: 10 },
    { date: "2026-11-01" },
    { ars: -80 },
  ];
  for (const fields of variations) expect(historicalAcquisitionFacts([], [statement], [{ ...line, payload: { ...line.payload, ...fields } }], [opening])).toEqual([]);
  expect(historicalAcquisitionFacts([], [statement], [line], [])).toEqual([]);
  const existing = historicalAcquisitionFacts([], [statement], [line], [opening]);
  expect(historicalAcquisitionFacts(existing, [statement], [line], [opening])).toEqual([]);
});

it("uses verified original financed receipt cost once instead of multiplying the observed installment", () => {
  const extraction = receiptExtraction();
  const receipt:ReceiptFacts = {revisionId:"receipt",receiptId:1,chain:"coto",fiscalId:"synthetic",date:extraction.parsed.header.date,totalMinor:8000,parsed:extraction.parsed,report:extraction.report,scale:extraction.scale,originalRowsObject:{sha256:"a".repeat(64),relativePath:"a".repeat(64)},correctedRowsObject:null,productReviewed:false};
  const first:SourceLine = {...line,payload:{...line.payload,date:receipt.date,description:"COTO SYNTHETIC",ars:39.99,installment_number:1,installment_count:2}};
  const association:HistoricalReceiptAssociation={id:"association",key:"association",digest:"d".repeat(64),receiptRevisionId:receipt.revisionId,sourceLineId:first.id,cardId:"card-a",currency:"ARS",receiptMinor:8000,statementMinor:3999,installmentCount:2,action:"link",previousDecisionId:null,method:"manual",recordedAt:"2026-10-02T12:00:00Z",legacyFingerprint:null,provenance:{}};
  const facts=receiptBackedHistoricalAcquisitions([], [association], [receipt], [statement], [first], [opening]);
  expect(facts).toMatchObject([{origin:"historical_acquisition",kind:"purchase",minor:8000,receiptIds:[1],purchaseId:null,financed:true}]);
  expect(3999*2).not.toBe(facts[0].minor);
  expect(receiptBackedHistoricalAcquisitions(facts, [association], [receipt], [statement], [first], [opening])).toEqual([]);
  expect(receiptBackedHistoricalAcquisitions([], [association], [receipt], [statement], [{...first,payload:{...first.payload,installment_number:2}}], [opening])).toEqual([]);
});
