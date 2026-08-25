import { addMonth, monthsBetween } from "@/lib/months";

export type RecurringCharge = {
  merchant: string;
  currency: "ARS" | "USD";
  occurrences: number;
  lastMonth: string;
  lastAmount: number;
  prevAmount: number | null;
  pctChange: number | null;
  nextExpectedMonth: string;
};

type Row = { merchant: string; month: string; ars: number | null; usd: number | null; installment_count?: number | null };

export function detectRecurring(
  rows: Row[],
  opts: { minMonths?: number; minDensity?: number } = {}
): RecurringCharge[] {
  const { minMonths = 3, minDensity = 0.6 } = opts;
  const groups = new Map<string, Map<string, number>>(); // "merchant|currency" -> month -> netted amount
  for (const r of rows) {
    if (r.installment_count != null) continue;
    let currency: "ARS" | "USD"; let amount: number;
    // Negatives ride along and net (rev note 2): a reversed double-charge is one charge,
    // not two, and a fully-reversed month is not an occurrence at all.
    if (r.ars != null) { currency = "ARS"; amount = r.ars; }
    else if (r.usd != null) { currency = "USD"; amount = r.usd; }
    else continue;
    const key = `${r.merchant}|${currency}`;
    const months = groups.get(key) ?? new Map();
    months.set(r.month, (months.get(r.month) ?? 0) + amount);
    groups.set(key, months);
  }
  const out: RecurringCharge[] = [];
  for (const [key, months] of groups) {
    const [merchant, currency] = key.split("|") as [string, "ARS" | "USD"];
    const sorted = [...months.keys()].filter(m => months.get(m)! > 0).sort();
    if (sorted.length < minMonths) continue;
    const span = monthsBetween(sorted[0], sorted[sorted.length - 1]);
    if (sorted.length / span < minDensity) continue;
    const lastMonth = sorted[sorted.length - 1];
    const prevMonth = sorted[sorted.length - 2];
    const lastAmount = months.get(lastMonth)!;
    const prevAmount = prevMonth ? months.get(prevMonth)! : null;
    out.push({
      merchant, currency,
      occurrences: sorted.length,
      lastMonth, lastAmount, prevAmount,
      pctChange: prevAmount ? ((lastAmount - prevAmount) / prevAmount) * 100 : null,
      nextExpectedMonth: addMonth(lastMonth),
    });
  }
  return out.sort((a, b) => (a.currency === b.currency ? b.lastAmount - a.lastAmount : a.currency === "ARS" ? -1 : 1));
}
