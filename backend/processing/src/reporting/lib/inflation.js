// Backend-owned pure analytical routines ported from the committed reference.
import { monthValue, CPI_REMEDY } from "./cpi";
function personalInflationIndex(rows, cpi) {
  const byMonth = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? /* @__PURE__ */ new Map();
    m.set(r.merchant, (m.get(r.merchant) ?? 0) + r.ars);
    byMonth.set(r.month, m);
  }
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return [];
  const cpiBase = monthValue(months[0], cpi, CPI_REMEDY);
  const out = [{ month: months[0], personal: 100, official: 100 }];
  let personal = 100;
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1]);
    const cur = byMonth.get(months[i]);
    let prevSum = 0, curSum = 0;
    for (const [merchant, amount] of cur) {
      const before = prev.get(merchant);
      if (before === void 0) continue;
      prevSum += before;
      curSum += amount;
    }
    if (prevSum > 0) personal *= curSum / prevSum;
    out.push({
      month: months[i],
      personal,
      official: 100 * (monthValue(months[i], cpi, CPI_REMEDY) / cpiBase)
    });
  }
  return out;
}
export {
  personalInflationIndex
};
