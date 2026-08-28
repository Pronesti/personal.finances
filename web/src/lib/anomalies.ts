import { toReal, type CpiTable } from "@/lib/cpi";
import { detectRecurring } from "@/lib/recurring";
import { DEFAULT_LOCALE, translate, type MessageKey, type Vars } from "@/lib/i18n";

// Structural subset of queries.ts' BaseRow, so baseRows(db) passes straight in.
export type AnomalyRow = {
  statement_id: number;
  merchant: string;
  month: string;
  date: string | null;
  ars: number | null;
  usd: number | null;
  installment_count: number | null;
};

export type Anomaly = {
  kind: "duplicate" | "amount_jump" | "new_merchant";
  merchant: string;
  month: string;
  date: string | null;
  amount: number;
  /** English prose, for callers that only want a string. The UI renders `messageKey` instead. */
  message: string;
  /** The same sentence as a dictionary key, so the page can render it in the reader's language. */
  messageKey: MessageKey;
  messageParams: Vars;
  resolved: boolean;
};

// One place builds both halves, so the English text and the localisable key can never drift.
function say(messageKey: MessageKey, messageParams: Vars) {
  return { messageKey, messageParams, message: translate(DEFAULT_LOCALE, messageKey, messageParams) };
}

// Tuned to this dataset, not knobs — see the plan's Task 6 header for what each one removes.
const MIN_AMOUNT = 10_000; // kills the PedidosYa tip pairs; smallest real hit is 57,613
const DAY_WINDOW = 2;      // Actual Budget's schedule-matching window
const JUMP_PCT = 25;       // real terms, i.e. above and beyond inflation

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400_000;
}

// Installment rows repeat across statements carrying the ORIGINAL purchase date and amount
// (TIENDANEWSAN: 13 rows, all 2025-07-17, all 166666.61) — never duplicates. And a pair must
// sit on ONE statement: the same purchase split across two cards is two real transactions.
function duplicates(rows: AnomalyRow[]): Anomaly[] {
  const candidates = rows.filter(
    r => r.installment_count == null && r.ars != null && r.ars >= MIN_AMOUNT && r.date != null
  );
  const reversals = new Set(
    rows.filter(r => r.ars != null && r.ars < 0).map(r => `${r.statement_id}|${r.merchant}|${-r.ars!}`)
  );
  const out: Anomaly[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (paired.has(j)) continue;
      const a = candidates[i], b = candidates[j];
      if (a.statement_id !== b.statement_id) continue;
      if (a.merchant !== b.merchant || a.ars !== b.ars) continue;
      if (daysApart(a.date!, b.date!) > DAY_WINDOW) continue;
      paired.add(j);
      const resolved = reversals.has(`${b.statement_id}|${b.merchant}|${b.ars}`);
      out.push({
        kind: "duplicate", merchant: a.merchant, month: b.month, date: b.date,
        amount: a.ars!, resolved,
        ...(resolved
          ? say("anomaly.duplicate.resolved", { date: b.date! })
          : say("anomaly.duplicate", { days: DAY_WINDOW, first: a.date!, second: b.date! })),
      });
      break;
    }
  }
  return out;
}

// In ARS everything rises monthly, so deflate first: the flag means "rose faster than inflation".
// And only compare months where the merchant billed exactly once — otherwise a supermarket's
// visit count reads as a price hike (ungated this fires 42 times on real data; gated, 6).
function amountJumps(rows: AnomalyRow[], cpi: CpiTable): Anomaly[] {
  const recurring = new Set(
    detectRecurring(rows, { cpi }).filter(r => r.currencies.includes("ARS")).map(r => r.merchant)
  );
  const totals = new Map<string, Map<string, number>>();
  const charges = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!recurring.has(r.merchant) || r.ars == null || r.installment_count != null) continue;
    const t = totals.get(r.merchant) ?? new Map<string, number>();
    const c = charges.get(r.merchant) ?? new Map<string, number>();
    t.set(r.month, (t.get(r.month) ?? 0) + r.ars);
    c.set(r.month, (c.get(r.month) ?? 0) + 1);
    totals.set(r.merchant, t); charges.set(r.merchant, c);
  }
  const base = Object.keys(cpi).sort().at(-1)!;
  const out: Anomaly[] = [];
  for (const [merchant, months] of totals) {
    const sorted = [...months.keys()].filter(m => months.get(m)! > 0).sort();
    const c = charges.get(merchant)!;
    for (let i = 1; i < sorted.length; i++) {
      const [pm, cm] = [sorted[i - 1], sorted[i]];
      if (c.get(pm) !== 1 || c.get(cm) !== 1) continue;
      const prev = toReal(months.get(pm)!, pm, base, cpi);
      const cur = toReal(months.get(cm)!, cm, base, cpi);
      const pct = ((cur - prev) / prev) * 100;
      if (pct <= JUMP_PCT) continue;
      out.push({
        kind: "amount_jump", merchant, month: cm, date: null,
        amount: months.get(cm)!, resolved: false,
        ...say("anomaly.amountJump", { pct: pct.toFixed(1), month: pm }),
      });
    }
  }
  return out;
}

function newMerchants(rows: AnomalyRow[]): Anomaly[] {
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latest = months.at(-1);
  if (!latest) return [];
  const firstSeen = new Map<string, string>();
  for (const r of rows) {
    const cur = firstSeen.get(r.merchant);
    if (cur === undefined || r.month < cur) firstSeen.set(r.merchant, r.month);
  }
  const totals = new Map<string, number>(); // one alert per merchant, not per charge
  for (const r of rows) {
    if (r.month !== latest || firstSeen.get(r.merchant) !== latest || r.ars == null) continue;
    totals.set(r.merchant, (totals.get(r.merchant) ?? 0) + r.ars);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount >= MIN_AMOUNT)
    .map(([merchant, amount]) => ({
      kind: "new_merchant" as const, merchant, month: latest, date: null,
      amount, resolved: false,
      ...say("anomaly.newMerchant", { months: months.length }),
    }));
}

export function detectAnomalies(rows: AnomalyRow[], cpi: CpiTable): Anomaly[] {
  if (rows.length === 0) return [];
  return [...duplicates(rows), ...amountJumps(rows, cpi), ...newMerchants(rows)]
    .sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount);
}
