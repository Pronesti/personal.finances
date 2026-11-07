// Backend-owned pure analytical routines ported from the committed reference.
function promoType(hasM, hasA) {
  if (hasM && hasA) return "mixed";
  if (hasM) return "mp";
  if (hasA) return "coto";
  return null;
}
const pct = (now, before) => (now - before) / before * 100;
const sortReceipts = (a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id - b.id;
function buildAnalytics(receiptsIn, items, rawItems) {
  const receipts = [...receiptsIn].sort(sortReceipts);
  const indexOf = new Map(receipts.map((r, i) => [r.id, i + 1]));
  const n = receipts.length;
  const periods = receipts.map((r, i) => {
    const mine = (rawItems ?? items).filter((it) => it.receiptId === r.id);
    const split = { mp: 0, coto: 0, mixed: 0 };
    for (const it of mine) {
      const t = promoType(it.hasM, it.hasA);
      if (t) split[t] += it.discountCents;
    }
    return {
      index: i + 1,
      receiptId: r.id,
      date: r.date,
      nItems: mine.length,
      grossCents: r.subtotalCents,
      discountsCents: r.discountsCents,
      totalCents: r.totalCents,
      savingsPct: r.subtotalCents === 0 ? 0 : -r.discountsCents * 100 / r.subtotalCents,
      mpCents: split.mp,
      cotoCents: split.coto,
      mixedCents: split.mixed
    };
  });
  let kpis = null;
  if (n > 0) {
    const last = periods[n - 1], prev = n > 1 ? periods[n - 2] : null;
    const accumulatedTotalCents = periods.reduce((s, p) => s + p.totalCents, 0);
    const avgTotalCents = accumulatedTotalCents / n;
    kpis = {
      nPeriods: n,
      lastTotalCents: last.totalCents,
      prevTotalCents: prev?.totalCents ?? null,
      deltaPct: prev && prev.totalCents !== 0 ? pct(last.totalCents, prev.totalCents) : null,
      avgTotalCents,
      monthlyProjectionCents: avgTotalCents * 4.33,
      accumulatedTotalCents,
      accumulatedSavingsCents: -periods.reduce((s, p) => s + p.discountsCents, 0)
    };
  }
  const byProduct = /* @__PURE__ */ new Map();
  for (const it of items) {
    const index2 = indexOf.get(it.receiptId);
    if (index2 === void 0) continue;
    const stat = byProduct.get(it.productId) ?? {
      productId: it.productId,
      name: it.productName,
      category: it.category,
      unit: it.unit,
      appearances: [],
      timesBought: 0,
      totalQtyMilli: 0,
      totalSpentCents: 0,
      totalDiscountCents: 0,
      lastChange: null
    };
    let app = stat.appearances.find((a) => a.index === index2);
    if (!app) {
      app = { index: index2, date: receipts[index2 - 1].date, qtyMilli: 0, grossCents: 0, discountCents: 0, netCents: 0, unitGross: 0, unitNet: 0 };
      stat.appearances.push(app);
    }
    app.qtyMilli += it.qtyMilli;
    app.grossCents += it.grossCents;
    app.discountCents += it.discountCents;
    app.netCents = app.grossCents + app.discountCents;
    app.unitGross = app.qtyMilli === 0 ? 0 : app.grossCents * 1e3 / app.qtyMilli;
    app.unitNet = app.qtyMilli === 0 ? 0 : app.netCents * 1e3 / app.qtyMilli;
    byProduct.set(it.productId, stat);
  }
  const products = [...byProduct.values()].map((stat) => {
    stat.appearances.sort((a, b) => a.index - b.index);
    stat.timesBought = stat.appearances.length;
    stat.totalQtyMilli = stat.appearances.reduce((s, a) => s + a.qtyMilli, 0);
    stat.totalSpentCents = stat.appearances.reduce((s, a) => s + a.netCents, 0);
    stat.totalDiscountCents = stat.appearances.reduce((s, a) => s + a.discountCents, 0);
    if (stat.appearances.length >= 2) {
      const [from, to] = stat.appearances.slice(-2);
      stat.lastChange = from.unitGross === 0 || from.unitNet === 0 ? null : { from: from.index, to: to.index, grossPct: pct(to.unitGross, from.unitGross), netPct: pct(to.unitNet, from.unitNet) };
    }
    return stat;
  }).sort((a, b) => b.totalSpentCents - a.totalSpentCents || a.name.localeCompare(b.name));
  const byCategory = /* @__PURE__ */ new Map();
  for (const p of products) {
    const c = byCategory.get(p.category) ?? { category: p.category, perPeriod: new Array(n).fill(0), totalNetCents: 0, totalDiscountCents: 0, sharePct: 0 };
    for (const a of p.appearances) c.perPeriod[a.index - 1] += a.netCents;
    c.totalNetCents += p.totalSpentCents;
    c.totalDiscountCents += p.totalDiscountCents;
    byCategory.set(p.category, c);
  }
  const allNet = [...byCategory.values()].reduce((s, c) => s + c.totalNetCents, 0);
  const categories = [...byCategory.values()].map((c) => ({ ...c, sharePct: allNet === 0 ? 0 : c.totalNetCents * 100 / allNet })).sort((a, b) => b.totalNetCents - a.totalNetCents);
  const index = [];
  let list = 100, effective = 100;
  for (let p = 1; p <= n; p++) {
    let numL = 0, denL = 0, numE = 0, denE = 0, nProducts = 0;
    for (const prod of products) {
      const now = prod.appearances.find((a) => a.index === p);
      if (!now) continue;
      const before = [...prod.appearances].reverse().find((a) => a.index < p);
      if (!before) continue;
      nProducts++;
      numL += now.qtyMilli * now.unitGross;
      denL += now.qtyMilli * before.unitGross;
      numE += now.qtyMilli * now.unitNet;
      denE += now.qtyMilli * before.unitNet;
    }
    const fL = denL > 0 ? numL / denL : null, fE = denE > 0 ? numE / denE : null;
    if (fL !== null) list *= fL;
    if (fE !== null) effective *= fE;
    index.push({
      index: p,
      date: receipts[p - 1].date,
      list,
      effective,
      factorListPct: fL === null ? null : (fL - 1) * 100,
      factorEffectivePct: fE === null ? null : (fE - 1) * 100,
      nProducts
    });
  }
  const frequency = {
    essentials: products.filter((p) => n >= 2 && p.timesBought === n),
    frequent: products.filter((p) => p.timesBought >= 2 && !(n >= 2 && p.timesBought === n)),
    occasional: products.filter((p) => p.timesBought === 1)
  };
  const basket = { entered: [], left: [] };
  if (n >= 2) {
    for (const p of products) {
      const now = p.appearances.find((a) => a.index === n), before = p.appearances.find((a) => a.index === n - 1);
      if (now && !before) basket.entered.push({ productId: p.productId, name: p.name, netCents: now.netCents });
      if (before && !now) basket.left.push({ productId: p.productId, name: p.name, netCents: before.netCents });
    }
    basket.entered.sort((a, b) => b.netCents - a.netCents);
    basket.left.sort((a, b) => b.netCents - a.netCents);
  }
  return { periods, kpis, products, categories, index, frequency, basket, top: products.slice(0, 15) };
}
export {
  buildAnalytics,
  promoType
};
