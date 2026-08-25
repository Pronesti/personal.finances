import { monthValue, CPI_REMEDY, type CpiTable } from "@/lib/cpi";

export type BasketPoint = { month: string; personal: number; official: number };

type BasketRow = { merchant: string; month: string; ars: number };

// Chained matched-merchant price index, both series based at 100 in the first month.
// Chaining (rather than a fixed base basket) is what survives real basket churn: merchants
// enter, leave, and switch billing currency across 19 months of statements.
export function personalInflationIndex(rows: BasketRow[], cpi: CpiTable): BasketPoint[] {
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? new Map<string, number>();
    m.set(r.merchant, (m.get(r.merchant) ?? 0) + r.ars);
    byMonth.set(r.month, m);
  }
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return [];

  const cpiBase = monthValue(months[0], cpi, CPI_REMEDY);
  const out: BasketPoint[] = [{ month: months[0], personal: 100, official: 100 }];
  let personal = 100;
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1])!;
    const cur = byMonth.get(months[i])!;
    let prevSum = 0, curSum = 0;
    for (const [merchant, amount] of cur) {
      const before = prev.get(merchant);
      if (before === undefined) continue; // only merchants charged in both months link the chain
      prevSum += before;
      curSum += amount;
    }
    if (prevSum > 0) personal *= curSum / prevSum;
    out.push({
      month: months[i],
      personal,
      official: 100 * (monthValue(months[i], cpi, CPI_REMEDY) / cpiBase),
    });
  }
  return out;
}
