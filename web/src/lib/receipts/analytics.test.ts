import { describe, it, expect } from "vitest";
import { buildAnalytics, promoType } from "@/lib/receipts/analytics";
import type { ReceiptFact, ItemFact } from "@/lib/receipts/facts";

const receipts: ReceiptFact[] = [
  { id: 1, date: "2026-08-07", time: "10:00:00", subtotalCents: 500000, discountsCents: -100000, totalCents: 400000 },
  { id: 2, date: "2026-08-14", time: "10:00:00", subtotalCents: 640000, discountsCents: -40000, totalCents: 600000 },
  { id: 3, date: "2026-08-21", time: "10:00:00", subtotalCents: 330000, discountsCents: 0, totalCents: 330000 },
];
const item = (o: Partial<ItemFact> & Pick<ItemFact, "receiptId" | "productId" | "qtyMilli" | "grossCents">): ItemFact => ({
  productName: `P${o.productId}`, category: o.productId === 3 ? "dairy" : "produce", unit: o.productId === 1 ? "kg" : "un",
  discountCents: 0, hasM: false, hasA: false, ...o,
});
const items: ItemFact[] = [
  // receipt 1: banana 1 kg @ 2000, water 2 @ 1000 with a MP discount, milk 1 @ 1000 with both tags
  item({ receiptId: 1, productId: 1, qtyMilli: 1000, grossCents: 200000 }),
  item({ receiptId: 1, productId: 2, qtyMilli: 2000, grossCents: 200000, discountCents: -50000, hasM: true }),
  item({ receiptId: 1, productId: 3, qtyMilli: 1000, grossCents: 100000, discountCents: -50000, hasM: true, hasA: true }),
  // receipt 2: banana 2 kg @ 2200 (+10% list), water 4 @ 1000 with a Coto discount, split in two lines
  item({ receiptId: 2, productId: 1, qtyMilli: 2000, grossCents: 440000 }),
  item({ receiptId: 2, productId: 2, qtyMilli: 2000, grossCents: 200000, discountCents: -40000, hasA: true }),
  item({ receiptId: 2, productId: 2, qtyMilli: 2000, grossCents: 200000 }),
  // receipt 3: banana 1.5 kg @ 2200 (flat), nothing else
  item({ receiptId: 3, productId: 1, qtyMilli: 1500, grossCents: 330000 }),
];

describe("promoType", () => {
  it("classifies by the tags a line carries", () => {
    expect(promoType(true, false)).toBe("mp");
    expect(promoType(false, true)).toBe("coto");
    expect(promoType(true, true)).toBe("mixed");
    expect(promoType(false, false)).toBeNull();
  });
});

describe("buildAnalytics", () => {
  const a = buildAnalytics(receipts, items);

  it("orders periods by date and splits discounts by promo type", () => {
    expect(a.periods.map(p => [p.index, p.date, p.nItems, p.grossCents, p.discountsCents, p.totalCents])).toEqual([
      [1, "2026-08-07", 3, 500000, -100000, 400000],
      [2, "2026-08-14", 3, 640000, -40000, 600000],
      [3, "2026-08-21", 1, 330000, 0, 330000],
    ]);
    expect(a.periods[0]).toMatchObject({ mpCents: -50000, cotoCents: 0, mixedCents: -50000, savingsPct: 20 });
    expect(a.periods[1]).toMatchObject({ mpCents: 0, cotoCents: -40000, mixedCents: 0, savingsPct: 6.25 });
  });

  it("computes the KPIs", () => {
    // The two derived floats are written as the same divisions the code performs, so they are
    // bit-identical; a decimal literal would not be.
    expect(a.kpis).toEqual({
      nPeriods: 3, lastTotalCents: 330000, prevTotalCents: 600000, deltaPct: -45,
      avgTotalCents: 1330000 / 3, monthlyProjectionCents: (1330000 / 3) * 4.33,
      accumulatedTotalCents: 1330000, accumulatedSavingsCents: 140000,
    });
  });

  it("weights a product's appearances by quantity and derives unit prices", () => {
    const water = a.products.find(p => p.productId === 2)!;
    expect(water.appearances).toEqual([
      { index: 1, date: "2026-08-07", qtyMilli: 2000, grossCents: 200000, discountCents: -50000, netCents: 150000, unitGross: 100000, unitNet: 75000 },
      { index: 2, date: "2026-08-14", qtyMilli: 4000, grossCents: 400000, discountCents: -40000, netCents: 360000, unitGross: 100000, unitNet: 90000 },
    ]);
    expect(water.lastChange).toMatchObject({ from: 1, to: 2, grossPct: 0 });
    expect(water.lastChange!.netPct).toBeCloseTo(20, 9); // 90000/75000 is not exactly 1.2 in binary
    expect(water).toMatchObject({ timesBought: 2, totalQtyMilli: 6000, totalSpentCents: 510000, totalDiscountCents: -90000 });
    const banana = a.products.find(p => p.productId === 1)!;
    expect(banana.lastChange).toEqual({ from: 2, to: 3, grossPct: 0, netPct: 0 });
    expect(banana.appearances.map(x => x.unitGross)).toEqual([200000, 220000, 220000]);
    const milk = a.products.find(p => p.productId === 3)!;
    expect(milk.lastChange).toBeNull();
  });

  it("chains the index from each product's previous appearance", () => {
    // period 2: banana 2 kg @ 2200 vs 2000 → 4400/4000; water 4 @ 1000 vs 1000 → 4000/4000.
    // list: (4400+4000)/(4000+4000) = 1.05 ; effective: banana 4400/4000, water 4×900=3600 vs 4×750=3000 → 8000/7000
    // period 3: banana 1.5 @ 2200 vs 2200 → 1.0 (only product with a past)
    expect(a.index.map(p => [p.index, p.nProducts])).toEqual([[1, 0], [2, 2], [3, 1]]);
    expect(a.index[0]).toMatchObject({ list: 100, effective: 100, factorListPct: null, factorEffectivePct: null });
    expect(a.index[1].list).toBeCloseTo(105, 6);
    expect(a.index[1].effective).toBeCloseTo(114.2857, 3);
    expect(a.index[1].factorListPct).toBeCloseTo(5, 6);
    expect(a.index[2].list).toBeCloseTo(105, 6);
    expect(a.index[2].factorListPct).toBeCloseTo(0, 6);
  });

  it("aggregates categories per period with share and discounts", () => {
    expect(a.categories).toEqual([
      { category: "produce", perPeriod: [350000, 800000, 330000], totalNetCents: 1480000, totalDiscountCents: -90000, sharePct: 1480000 * 100 / 1530000 },
      { category: "dairy", perPeriod: [50000, 0, 0], totalNetCents: 50000, totalDiscountCents: -50000, sharePct: 50000 * 100 / 1530000 },
    ]);
  });

  it("sorts habits, basket changes and top products", () => {
    expect(a.frequency.essentials.map(p => p.productId)).toEqual([1]);
    expect(a.frequency.frequent.map(p => p.productId)).toEqual([2]);
    expect(a.frequency.occasional.map(p => p.productId)).toEqual([3]);
    expect(a.basket).toEqual({ entered: [], left: [{ productId: 2, name: "P2", netCents: 360000 }] });
    expect(a.top.map(p => p.productId)).toEqual([1, 2, 3]);
  });

  it("handles no receipts", () => {
    const empty = buildAnalytics([], []);
    expect(empty.periods).toEqual([]);
    expect(empty.kpis).toBeNull();
    expect(empty.index).toEqual([]);
  });

  it("keeps lastChange null when an earlier appearance was fully discounted", () => {
    // productId 9 was free (100% discount) in receipt 1, then paid normally in receipt 2: the
    // earlier unitNet is 0, so a percent change against it would be Infinity, not a real signal.
    const freeItems: ItemFact[] = [
      item({ receiptId: 1, productId: 9, qtyMilli: 1000, grossCents: 100000, discountCents: -100000 }),
      item({ receiptId: 2, productId: 9, qtyMilli: 1000, grossCents: 100000 }),
    ];
    const fa = buildAnalytics(receipts, freeItems);
    const free = fa.products.find(p => p.productId === 9)!;
    expect(free.appearances.map(x => [x.unitGross, x.unitNet])).toEqual([[100000, 0], [100000, 100000]]);
    expect(free.lastChange).toBeNull();
    for (const p of fa.products) {
      for (const x of p.appearances) {
        expect(Number.isFinite(x.unitGross)).toBe(true);
        expect(Number.isFinite(x.unitNet)).toBe(true);
      }
    }
  });
});
