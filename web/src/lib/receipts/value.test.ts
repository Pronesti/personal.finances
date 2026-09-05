import { describe, it, expect } from "vitest";
import { valueCents, valueFacts } from "@/lib/receipts/value";
import type { ValueOpts } from "@/lib/queries";
import type { ReceiptFact, ItemFact } from "@/lib/receipts/facts";

const cpi = { "2026-06": 100, "2026-07": 110 };
const mep = { "2026-06": 1000, "2026-07": 1250 };
const opts = (value: ValueOpts["value"]): ValueOpts => ({ spend: "cash", value, tax: "excl", cpi, mep });
const receipts: ReceiptFact[] = [
  { id: 1, date: "2026-06-10", time: null, subtotalCents: 120000, discountsCents: -20000, totalCents: 100000 },
  { id: 2, date: "2026-08-10", time: null, subtotalCents: 50000, discountsCents: 0, totalCents: 50000 }, // past both tables
];
const items: ItemFact[] = [
  { receiptId: 1, productId: 1, productName: "P1", category: "produce", unit: "kg", qtyMilli: 1500, grossCents: 120000, discountCents: -20000, hasM: true, hasA: false },
  { receiptId: 2, productId: 1, productName: "P1", category: "produce", unit: "kg", qtyMilli: 1000, grossCents: 50000, discountCents: 0, hasM: false, hasA: false },
];

describe("valueCents", () => {
  it("restates cents in real pesos of the base month, in USD cents at MEP, or leaves them", () => {
    expect(valueCents(100000, "2026-06", opts("real"), "2026-07")).toBe(110000);
    expect(valueCents(100000, "2026-06", opts("usd"), "")).toBe(100);
    expect(valueCents(100000, "2026-06", opts("nominal"), "")).toBe(100000);
    expect(valueCents(33333, "2026-06", opts("real"), "2026-07")).toBe(36666); // 36666.3, back to integer cents
  });
});

describe("valueFacts", () => {
  it("is the identity in nominal mode", () => {
    expect(valueFacts({ receipts, items }, opts("nominal"))).toEqual({ receipts, items });
  });

  it("converts every money field by the receipt's month and nothing else", () => {
    const real = valueFacts({ receipts, items }, opts("real"));
    expect(real.receipts[0]).toEqual({ ...receipts[0], subtotalCents: 132000, discountsCents: -22000, totalCents: 110000 });
    expect(real.items[0]).toEqual({ ...items[0], grossCents: 132000, discountCents: -22000 });
    // A month past the CPI table reads at the latest month: unchanged until the index is published.
    expect(real.receipts[1]).toEqual(receipts[1]);
    expect(real.items[1]).toEqual(items[1]);

    const usd = valueFacts({ receipts, items }, opts("usd"));
    expect(usd.receipts[0]).toEqual({ ...receipts[0], subtotalCents: 120, discountsCents: -20, totalCents: 100 });
    expect(usd.receipts[1].totalCents).toBe(40); // 50000 / 1250, the latest MEP
    expect(usd.items[1]).toEqual({ ...items[1], grossCents: 40, discountCents: 0 });
  });
});
