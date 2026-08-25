import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";

export type SpendMode = "cash" | "accrual";
export type ValueMode = "nominal" | "real";
export type ValueOpts = { spend: SpendMode; value: ValueMode; cpi: CpiTable };

type BaseRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

function baseRows(db: Database.Database): BaseRow[] {
  // Negatives net against spend; USD-only rows ride along for drill/recurring (rev notes 2-3).
  return db.prepare(`
    SELECT s.cycle_month AS month, t.date, t.description, t.merchant,
           t.category, t.subcategory, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' AND (t.ars != 0 OR (t.ars IS NULL AND t.usd > 0))
    ORDER BY s.cycle_month, t.date
  `).all() as BaseRow[];
}

type AmountCtx = { baseMonth: string; minK: Map<string, number> };

function amountCtx(rows: BaseRow[], opts: ValueOpts): AmountCtx {
  const minK = new Map<string, number>();
  for (const r of rows) {
    if (r.installment_count == null || r.installment_number == null) continue;
    const key = `${r.merchant}|${r.installment_count}`;
    const cur = minK.get(key);
    if (cur === undefined || r.installment_number < cur) minK.set(key, r.installment_number);
  }
  return { baseMonth: latestMonth(opts.cpi), minK };
}

// The single home of cash/accrual/real semantics. Returns null when the row
// doesn't contribute to ARS aggregates in this mode (USD-only, or a non-first cuota in accrual).
function effectiveAmount(r: BaseRow, opts: ValueOpts, ctx: AmountCtx): number | null {
  if (r.ars == null) return null; // USD-only: visible in drill rows, never in ARS sums
  let amt = r.ars;
  if (opts.spend === "accrual" && r.installment_count != null && r.installment_number != null) {
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}`)!;
    if (r.installment_number !== k) return null;
    amt = r.ars * (r.installment_count - k + 1); // remaining principal; full price when k=1 (rev note 4)
  }
  if (opts.value === "real") amt = toReal(amt, r.month, ctx.baseMonth, opts.cpi);
  return amt;
}

export function monthlySpendByCategory(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const key = `${r.month}|${r.category}`;
    acc.set(key, (acc.get(key) ?? 0) + amt);
  }
  return [...acc.entries()]
    .map(([k, amount]) => { const [month, category] = k.split("|"); return { month, category, amount }; })
    .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
}

export type DrillRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; amount: number | null; usd: number | null;
};

export function categoryDrill(
  db: Database.Database, opts: ValueOpts,
  filter: { category?: string; subcategory?: string; month?: string }
) {
  const level: "category" | "subcategory" | "merchant" =
    !filter.category ? "category" : !filter.subcategory ? "subcategory" : "merchant";
  const all = baseRows(db);
  const ctx = amountCtx(all, opts);
  const rows: DrillRow[] = [];
  const groups = new Map<string, number>();
  for (const r of all) {
    if (filter.category && r.category !== filter.category) continue;
    if (filter.subcategory && (r.subcategory ?? "(none)") !== filter.subcategory) continue;
    if (filter.month && r.month !== filter.month) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null && r.usd == null) continue; // dropped by mode (non-first cuota in accrual)
    rows.push({ month: r.month, date: r.date, description: r.description, merchant: r.merchant,
      category: r.category, subcategory: r.subcategory, amount: amt, usd: r.usd });
    if (amt != null) {
      const key = level === "category" ? r.category : level === "subcategory" ? (r.subcategory ?? "(none)") : r.merchant;
      groups.set(key, (groups.get(key) ?? 0) + amt);
    }
  }
  return {
    level,
    rows: rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    groups: [...groups.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function recurringTable(db: Database.Database): RecurringCharge[] {
  return detectRecurring(baseRows(db));
}

export function periodComparison(
  db: Database.Database, opts: ValueOpts, granularity: "month" | "quarter" | "year"
) {
  const rows = baseRows(db);
  const ctx = amountCtx(rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const [y, m] = r.month.split("-").map(Number);
    const period = granularity === "month" ? r.month
      : granularity === "quarter" ? `${y}-Q${Math.ceil(m / 3)}` : String(y);
    acc.set(period, (acc.get(period) ?? 0) + amt);
  }
  const sorted = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([period, amount], i) => ({
    period, amount,
    pctVsPrev: i === 0 ? null : ((amount - sorted[i - 1][1]) / sorted[i - 1][1]) * 100,
  }));
}

export function coverage(db: Database.Database): { month: string; brands: string[] }[] {
  const rows = db.prepare(
    "SELECT cycle_month AS month, GROUP_CONCAT(DISTINCT brand) AS b FROM statements GROUP BY cycle_month ORDER BY cycle_month"
  ).all() as { month: string; b: string }[];
  return rows.map(r => ({ month: r.month, brands: r.b.split(",").sort() }));
}

export function eli5(db: Database.Database, opts: ValueOpts) {
  const months = monthlySpendByCategory(db, opts);
  if (months.length === 0) throw new Error("No statements ingested — run npm run ingest");
  const byMonth = new Map<string, number>();
  for (const m of months) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.amount);
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const [lastMonthKey, spentThisMonth] = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2][1] : null;

  // Latest statement per brand — two cards close the same day; LIMIT 1 would drop one (rev note 10).
  const latestPerBrand = db.prepare(`
    SELECT s.id, s.closing_date, s.due_date FROM statements s
    JOIN (SELECT brand, MAX(closing_date) mc FROM statements GROUP BY brand) x
      ON x.brand = s.brand AND x.mc = s.closing_date
  `).all() as { id: number; closing_date: string; due_date: string | null }[];
  const ids = latestPerBrand.map(s => s.id);
  const upcoming = db.prepare(
    `SELECT month, SUM(amount_ars) amount FROM upcoming_installments
     WHERE statement_id IN (${ids.map(() => "?").join(",")}) GROUP BY month ORDER BY month`
  ).all(...ids) as { month: string; amount: number }[];

  const alerts = db.prepare("SELECT kind, message FROM alerts ORDER BY id DESC LIMIT 5")
    .all() as { kind: string; message: string }[];

  const latest = latestPerBrand.sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];

  return {
    spentThisMonth,
    pctVsPrev: prev ? ((spentThisMonth - prev) / prev) * 100 : null,
    committedNextMonth: upcoming[0]?.amount ?? 0,
    topCategories: months.filter(m => m.month === lastMonthKey)
      .sort((a, b) => b.amount - a.amount).slice(0, 3)
      .map(m => ({ category: m.category, amount: m.amount })),
    alerts,
    cuotaMonths: upcoming.length,
    cuotaTotal: upcoming.reduce((s, u) => s + u.amount, 0),
    sparkline: sorted.slice(-12).map(([month, amount]) => ({ month, amount })),
    latestClosing: latest.closing_date,
    nextDueDate: latest.due_date,
    baseMonth: latestMonth(opts.cpi),
  };
}
