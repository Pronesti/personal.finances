// Backend-owned pure analytical routines ported from the committed reference.
import { addMonth, monthsBetween } from "./months";
import { latestMonth, toReal } from "./cpi";
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function relativeMad(values) {
  const med = median(values);
  if (med <= 0) return Infinity;
  return median(values.map((v) => Math.abs(v - med))) / med;
}
function peggedFraction(values) {
  if (values.length < 2) return 0;
  let held = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && Math.abs(values[i] / values[i - 1] - 1) <= 0.01) held += 1;
  }
  return held / (values.length - 1);
}
function classifyRegime(nominal, real, minPegFraction, maxRealMad) {
  if (peggedFraction(nominal) >= minPegFraction) return "pegged";
  if (real && relativeMad(real) <= maxRealMad) return "indexed";
  return null;
}
function deflate(months, nominal, cpi) {
  if (!cpi) return null;
  try {
    const base = latestMonth(cpi);
    return months.map((m, i) => toReal(nominal[i], m, base, cpi));
  } catch {
    return null;
  }
}
function detectRecurring(rows, opts = {}) {
  const {
    minMonths = 4,
    minDensity = 0.6,
    maxGap = 2,
    minPegFraction = 0.25,
    maxRealMad = 0.08,
    cpi
  } = opts;
  const groups = /* @__PURE__ */ new Map();
  let newestSeen = "";
  for (const r of rows) {
    if (r.installment_count != null) continue;
    let currency;
    let amount;
    if (r.ars != null) {
      currency = "ARS";
      amount = r.ars;
    } else if (r.usd != null) {
      currency = "USD";
      amount = r.usd;
    } else continue;
    if (r.month > newestSeen) newestSeen = r.month;
    const months = groups.get(r.merchant) ?? /* @__PURE__ */ new Map();
    const cell = months.get(r.month);
    if (!cell) months.set(r.month, { amount, currency });
    else if (cell.currency === currency) cell.amount += amount;
    else if (currency === "ARS") months.set(r.month, { amount, currency });
    groups.set(r.merchant, months);
  }
  const latestMonth2 = opts.latestMonth ?? newestSeen;
  const out = [];
  for (const [merchant, months] of groups) {
    const sorted = [...months.keys()].filter((m) => months.get(m).amount > 0).sort();
    if (sorted.length < minMonths) continue;
    const firstMonth = sorted[0];
    const lastMonth = sorted[sorted.length - 1];
    const span = monthsBetween(firstMonth, lastMonth);
    if (sorted.length / span < minDensity) continue;
    const prevMonth = sorted[sorted.length - 2];
    const last = months.get(lastMonth);
    const prev = prevMonth ? months.get(prevMonth) : null;
    const comparablePrev = prev && prev.currency === last.currency ? prev.amount : null;
    const monthsSinceLast = monthsBetween(lastMonth, latestMonth2) - 1;
    const status = monthsSinceLast >= maxGap ? "lapsed" : "active";
    const priced = sorted.filter((m) => months.get(m).currency === last.currency);
    const nominal = priced.map((m) => months.get(m).amount);
    const real = last.currency === "USD" ? nominal : deflate(priced, nominal, cpi);
    const priceRegime = classifyRegime(nominal, real, minPegFraction, maxRealMad);
    out.push({
      merchant,
      currency: last.currency,
      currencies: [...new Set(sorted.map((m) => months.get(m).currency))].sort(),
      occurrences: sorted.length,
      firstMonth,
      lastMonth,
      lastAmount: last.amount,
      prevAmount: comparablePrev,
      pctChange: comparablePrev ? (last.amount - comparablePrev) / comparablePrev * 100 : null,
      monthsSinceLast,
      status,
      confidence: priceRegime ? "high" : "low",
      priceRegime,
      nextExpectedMonth: status === "active" ? addMonth(lastMonth) : null
    });
  }
  const rank = (r) => (r.status === "active" ? 0 : 2) + (r.confidence === "high" ? 0 : 1);
  return out.sort(
    (a, b) => rank(a) - rank(b) || (a.currency === b.currency ? b.lastAmount - a.lastAmount : a.currency === "ARS" ? -1 : 1)
  );
}
export {
  detectRecurring
};
