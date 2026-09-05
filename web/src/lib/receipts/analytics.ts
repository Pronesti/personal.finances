import type { ProductCategory } from "./categories";
import type { ReceiptFact, ItemFact } from "./facts";

export type PromoType = "mp" | "coto" | "mixed";
export type Period = {
  index: number; receiptId: number; date: string; nItems: number;
  grossCents: number; discountsCents: number; totalCents: number; savingsPct: number;
  mpCents: number; cotoCents: number; mixedCents: number;
};
export type Appearance = {
  index: number; date: string; qtyMilli: number; grossCents: number; discountCents: number; netCents: number;
  /** Cents per unit or per kg, derived: gross / qty and net / qty. Floats, never stored. */
  unitGross: number; unitNet: number;
};
export type ProductStat = {
  productId: number; name: string; category: ProductCategory; unit: "un" | "kg";
  appearances: Appearance[]; timesBought: number; totalQtyMilli: number; totalSpentCents: number; totalDiscountCents: number;
  lastChange: { from: number; to: number; grossPct: number; netPct: number } | null;
};
export type CategoryStat = {
  category: ProductCategory; perPeriod: number[]; totalNetCents: number; totalDiscountCents: number; sharePct: number;
};
export type IndexPoint = {
  index: number; date: string; list: number; effective: number;
  factorListPct: number | null; factorEffectivePct: number | null; nProducts: number;
};
export type Kpis = {
  nPeriods: number; lastTotalCents: number; prevTotalCents: number | null; deltaPct: number | null;
  avgTotalCents: number; monthlyProjectionCents: number; accumulatedTotalCents: number; accumulatedSavingsCents: number;
};
export type BasketChange = { productId: number; name: string; netCents: number };
export type Analytics = {
  periods: Period[];
  kpis: Kpis | null;
  products: ProductStat[];
  categories: CategoryStat[];
  index: IndexPoint[];
  frequency: { essentials: ProductStat[]; frequent: ProductStat[]; occasional: ProductStat[] };
  basket: { entered: BasketChange[]; left: BasketChange[] };
  top: ProductStat[];
};

export function promoType(hasM: boolean, hasA: boolean): PromoType | null {
  if (hasM && hasA) return "mixed";
  if (hasM) return "mp";
  if (hasA) return "coto";
  return null;
}

const pct = (now: number, before: number) => (now - before) / before * 100;
const sortReceipts = (a: ReceiptFact, b: ReceiptFact) =>
  a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id - b.id;

/**
 * Every analysis of spec §8, from two flat arrays, in receipt order. Pure: the pages call it on
 * every request and the tests feed it by hand. A "period" is one receipt (decision 6).
 */
export function buildAnalytics(receiptsIn: ReceiptFact[], items: ItemFact[]): Analytics {
  const receipts = [...receiptsIn].sort(sortReceipts);
  const indexOf = new Map(receipts.map((r, i) => [r.id, i + 1]));
  const n = receipts.length;

  // ── periods ──
  const periods: Period[] = receipts.map((r, i) => {
    const mine = items.filter(it => it.receiptId === r.id);
    const split = { mp: 0, coto: 0, mixed: 0 };
    for (const it of mine) {
      const t = promoType(it.hasM, it.hasA);
      if (t) split[t] += it.discountCents;
    }
    return {
      index: i + 1, receiptId: r.id, date: r.date, nItems: mine.length,
      grossCents: r.subtotalCents, discountsCents: r.discountsCents, totalCents: r.totalCents,
      savingsPct: r.subtotalCents === 0 ? 0 : -r.discountsCents * 100 / r.subtotalCents,
      mpCents: split.mp, cotoCents: split.coto, mixedCents: split.mixed,
    };
  });

  // ── kpis ──
  let kpis: Kpis | null = null;
  if (n > 0) {
    const last = periods[n - 1], prev = n > 1 ? periods[n - 2] : null;
    const accumulatedTotalCents = periods.reduce((s, p) => s + p.totalCents, 0);
    const avgTotalCents = accumulatedTotalCents / n;
    kpis = {
      nPeriods: n, lastTotalCents: last.totalCents, prevTotalCents: prev?.totalCents ?? null,
      deltaPct: prev && prev.totalCents !== 0 ? pct(last.totalCents, prev.totalCents) : null,
      avgTotalCents, monthlyProjectionCents: avgTotalCents * 4.33,
      accumulatedTotalCents, accumulatedSavingsCents: -periods.reduce((s, p) => s + p.discountsCents, 0),
    };
  }

  // ── products: one appearance per (product, period), quantity-weighted ──
  const byProduct = new Map<number, ProductStat>();
  for (const it of items) {
    const index = indexOf.get(it.receiptId);
    if (index === undefined) continue;
    const stat = byProduct.get(it.productId) ?? {
      productId: it.productId, name: it.productName, category: it.category, unit: it.unit,
      appearances: [], timesBought: 0, totalQtyMilli: 0, totalSpentCents: 0, totalDiscountCents: 0, lastChange: null,
    };
    let app = stat.appearances.find(a => a.index === index);
    if (!app) {
      app = { index, date: receipts[index - 1].date, qtyMilli: 0, grossCents: 0, discountCents: 0, netCents: 0, unitGross: 0, unitNet: 0 };
      stat.appearances.push(app);
    }
    app.qtyMilli += it.qtyMilli;
    app.grossCents += it.grossCents;
    app.discountCents += it.discountCents;
    app.netCents = app.grossCents + app.discountCents;
    app.unitGross = app.qtyMilli === 0 ? 0 : app.grossCents * 1000 / app.qtyMilli;
    app.unitNet = app.qtyMilli === 0 ? 0 : app.netCents * 1000 / app.qtyMilli;
    byProduct.set(it.productId, stat);
  }
  const products = [...byProduct.values()].map(stat => {
    stat.appearances.sort((a, b) => a.index - b.index);
    stat.timesBought = stat.appearances.length;
    stat.totalQtyMilli = stat.appearances.reduce((s, a) => s + a.qtyMilli, 0);
    stat.totalSpentCents = stat.appearances.reduce((s, a) => s + a.netCents, 0);
    stat.totalDiscountCents = stat.appearances.reduce((s, a) => s + a.discountCents, 0);
    if (stat.appearances.length >= 2) {
      const [from, to] = stat.appearances.slice(-2);
      stat.lastChange = from.unitGross === 0 || from.unitNet === 0 ? null
        : { from: from.index, to: to.index, grossPct: pct(to.unitGross, from.unitGross), netPct: pct(to.unitNet, from.unitNet) };
    }
    return stat;
  }).sort((a, b) => b.totalSpentCents - a.totalSpentCents || a.name.localeCompare(b.name));

  // ── categories ──
  const byCategory = new Map<ProductCategory, CategoryStat>();
  for (const p of products) {
    const c = byCategory.get(p.category) ?? { category: p.category, perPeriod: new Array<number>(n).fill(0), totalNetCents: 0, totalDiscountCents: 0, sharePct: 0 };
    for (const a of p.appearances) c.perPeriod[a.index - 1] += a.netCents;
    c.totalNetCents += p.totalSpentCents;
    c.totalDiscountCents += p.totalDiscountCents;
    byCategory.set(p.category, c);
  }
  const allNet = [...byCategory.values()].reduce((s, c) => s + c.totalNetCents, 0);
  const categories = [...byCategory.values()]
    .map(c => ({ ...c, sharePct: allNet === 0 ? 0 : c.totalNetCents * 100 / allNet }))
    .sort((a, b) => b.totalNetCents - a.totalNetCents);

  // ── chained index: this period's basket at this period's prices vs at each product's previous price ──
  const index: IndexPoint[] = [];
  let list = 100, effective = 100;
  for (let p = 1; p <= n; p++) {
    let numL = 0, denL = 0, numE = 0, denE = 0, nProducts = 0;
    for (const prod of products) {
      const now = prod.appearances.find(a => a.index === p);
      if (!now) continue;
      const before = [...prod.appearances].reverse().find(a => a.index < p);
      if (!before) continue;
      nProducts++;
      numL += now.qtyMilli * now.unitGross; denL += now.qtyMilli * before.unitGross;
      numE += now.qtyMilli * now.unitNet;   denE += now.qtyMilli * before.unitNet;
    }
    const fL = denL > 0 ? numL / denL : null, fE = denE > 0 ? numE / denE : null;
    if (fL !== null) list *= fL;
    if (fE !== null) effective *= fE;
    index.push({
      index: p, date: receipts[p - 1].date, list, effective,
      factorListPct: fL === null ? null : (fL - 1) * 100, factorEffectivePct: fE === null ? null : (fE - 1) * 100, nProducts,
    });
  }

  // ── habits, basket, top ──
  const frequency = {
    essentials: products.filter(p => n >= 2 && p.timesBought === n),
    frequent: products.filter(p => p.timesBought >= 2 && !(n >= 2 && p.timesBought === n)),
    occasional: products.filter(p => p.timesBought === 1),
  };
  const basket = { entered: [] as BasketChange[], left: [] as BasketChange[] };
  if (n >= 2) {
    for (const p of products) {
      const now = p.appearances.find(a => a.index === n), before = p.appearances.find(a => a.index === n - 1);
      if (now && !before) basket.entered.push({ productId: p.productId, name: p.name, netCents: now.netCents });
      if (before && !now) basket.left.push({ productId: p.productId, name: p.name, netCents: before.netCents });
    }
    basket.entered.sort((a, b) => b.netCents - a.netCents);
    basket.left.sort((a, b) => b.netCents - a.netCents);
  }
  return { periods, kpis, products, categories, index, frequency, basket, top: products.slice(0, 15) };
}
