// Backend-owned pure analytical routines ported from the committed reference.
import { toReal } from "./cpi";
import { detectRecurring } from "./recurring";
import { DEFAULT_LOCALE, translate } from "./i18n";
function say(messageKey, messageParams) {
  return { messageKey, messageParams, message: translate(DEFAULT_LOCALE, messageKey, messageParams) };
}
const MIN_AMOUNT = 1e4;
const DAY_WINDOW = 2;
const JUMP_PCT = 25;
function daysApart(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;
}
function duplicates(rows) {
  const candidates = rows.filter(
    (r) => r.installment_count == null && r.ars != null && r.ars >= MIN_AMOUNT && r.date != null
  );
  const reversals = new Set(
    rows.filter((r) => r.ars != null && r.ars < 0).map((r) => `${r.statement_id}|${r.merchant}|${-r.ars}`)
  );
  const out = [];
  const paired = /* @__PURE__ */ new Set();
  for (let i = 0; i < candidates.length; i++) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (paired.has(j)) continue;
      const a = candidates[i], b = candidates[j];
      if (a.statement_id !== b.statement_id) continue;
      if (a.merchant !== b.merchant || a.ars !== b.ars) continue;
      if (daysApart(a.date, b.date) > DAY_WINDOW) continue;
      paired.add(j);
      const resolved = reversals.has(`${b.statement_id}|${b.merchant}|${b.ars}`);
      out.push({
        kind: "duplicate",
        merchant: a.merchant,
        month: b.month,
        date: b.date,
        amount: a.ars,
        resolved,
        ...resolved ? say("anomaly.duplicate.resolved", { date: b.date }) : say("anomaly.duplicate", { days: DAY_WINDOW, first: a.date, second: b.date })
      });
      break;
    }
  }
  return out;
}
function amountJumps(rows, cpi) {
  const recurring = new Set(
    detectRecurring(rows, { cpi }).filter((r) => r.currencies.includes("ARS")).map((r) => r.merchant)
  );
  const totals = /* @__PURE__ */ new Map();
  const charges = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!recurring.has(r.merchant) || r.ars == null || r.installment_count != null) continue;
    const t = totals.get(r.merchant) ?? /* @__PURE__ */ new Map();
    const c = charges.get(r.merchant) ?? /* @__PURE__ */ new Map();
    t.set(r.month, (t.get(r.month) ?? 0) + r.ars);
    c.set(r.month, (c.get(r.month) ?? 0) + 1);
    totals.set(r.merchant, t);
    charges.set(r.merchant, c);
  }
  const base = Object.keys(cpi).sort().at(-1);
  const out = [];
  for (const [merchant, months] of totals) {
    const sorted = [...months.keys()].filter((m) => months.get(m) > 0).sort();
    const c = charges.get(merchant);
    for (let i = 1; i < sorted.length; i++) {
      const [pm, cm] = [sorted[i - 1], sorted[i]];
      if (c.get(pm) !== 1 || c.get(cm) !== 1) continue;
      const prev = toReal(months.get(pm), pm, base, cpi);
      const cur = toReal(months.get(cm), cm, base, cpi);
      const pct = (cur - prev) / prev * 100;
      if (pct <= JUMP_PCT) continue;
      out.push({
        kind: "amount_jump",
        merchant,
        month: cm,
        date: null,
        amount: months.get(cm),
        resolved: false,
        ...say("anomaly.amountJump", { pct: pct.toFixed(1), month: pm })
      });
    }
  }
  return out;
}
function newMerchants(rows) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const latest = months.at(-1);
  if (!latest) return [];
  const firstSeen = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const cur = firstSeen.get(r.merchant);
    if (cur === void 0 || r.month < cur) firstSeen.set(r.merchant, r.month);
  }
  const totals = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (r.month !== latest || firstSeen.get(r.merchant) !== latest || r.ars == null) continue;
    totals.set(r.merchant, (totals.get(r.merchant) ?? 0) + r.ars);
  }
  return [...totals.entries()].filter(([, amount]) => amount >= MIN_AMOUNT).map(([merchant, amount]) => ({
    kind: "new_merchant",
    merchant,
    month: latest,
    date: null,
    amount,
    resolved: false,
    ...say("anomaly.newMerchant", { months: months.length })
  }));
}
function detectAnomalies(rows, cpi) {
  if (rows.length === 0) return [];
  return [...duplicates(rows), ...amountJumps(rows, cpi), ...newMerchants(rows)].sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount);
}
export {
  detectAnomalies
};
