import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { mepFor, type MepTable } from "@/lib/mep";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";

export type SpendMode = "cash" | "accrual";
export type ValueMode = "nominal" | "real" | "usd";
export type TaxMode = "excl" | "incl";
export type ValueOpts = {
  spend: SpendMode; value: ValueMode; tax: TaxMode; cpi: CpiTable; mep: MepTable;
};

type BaseRow = {
  statement_id: number;
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; ars: number | null; usd: number | null;
  installment_number: number | null; installment_count: number | null;
};

function baseRows(db: Database.Database): BaseRow[] {
  // Negatives net against spend, in BOTH currencies (rev note 2) — a USD refund must be able
  // to cancel its USD charge. USD rows ride along for drill/recurring (rev note 3).
  return db.prepare(`
    SELECT t.statement_id, s.cycle_month AS month, t.date, t.description, t.merchant,
           t.category, t.subcategory, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases'
      AND ((t.ars IS NOT NULL AND t.ars != 0) OR (t.ars IS NULL AND t.usd IS NOT NULL AND t.usd != 0))
    ORDER BY s.cycle_month, t.date
  `).all() as BaseRow[];
}

type AmountCtx = { baseMonth: string; minK: Map<string, number>; taxMult: Map<number, number> };

// Taxes are levied per statement, not per purchase — the JSON carries no link. Spread each
// statement's tax total across its purchases in proportion to amount (spec §3, "true cost").
// Two corrections keep this honest on real data:
//   - DEVOLUCION DE SALDOS is a balance transfer, not a tax. Its positive sign is arithmetically
//     correct (the statement reconciles with it), so exclude it rather than negating it.
//   - DB.RG 5617 is levied on FOREIGN spend, so USD purchases (at MEP) belong in the denominator.
// Without both, the worst real statement reaches x2.22; with them, x1.22.
function taxMultipliers(db: Database.Database, opts: ValueOpts): Map<number, number> {
  const mult = new Map<number, number>();
  if (opts.tax !== "incl") return mult;
  const rows = db.prepare(`
    SELECT t.statement_id, s.cycle_month AS month,
           SUM(CASE WHEN t.section = 'taxes_and_charges'
                     AND t.description NOT LIKE 'DEVOLUCION%' THEN t.ars ELSE 0 END) AS tax,
           SUM(CASE WHEN t.section = 'purchases' AND t.ars IS NOT NULL THEN t.ars ELSE 0 END) AS ars_purch,
           SUM(CASE WHEN t.section = 'purchases' AND t.ars IS NULL THEN COALESCE(t.usd, 0) ELSE 0 END) AS usd_purch
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    GROUP BY t.statement_id
  `).all() as { statement_id: number; month: string; tax: number; ars_purch: number; usd_purch: number }[];
  for (const r of rows) {
    const base = r.ars_purch + r.usd_purch * mepFor(r.month, opts.mep);
    if (base > 0) mult.set(r.statement_id, 1 + r.tax / base);
  }
  return mult;
}

function amountCtx(db: Database.Database, rows: BaseRow[], opts: ValueOpts): AmountCtx {
  const minK = new Map<string, number>();
  for (const r of rows) {
    if (r.installment_count == null || r.installment_number == null) continue;
    // merchant+count is NOT a series id — MERCADOLIBRE|6 covers six distinct purchases.
    // The purchase date is constant across a real series, so it completes the key.
    const key = `${r.merchant}|${r.installment_count}|${r.date ?? ""}`;
    const cur = minK.get(key);
    if (cur === undefined || r.installment_number < cur) minK.set(key, r.installment_number);
  }
  return {
    baseMonth: opts.value === "real" ? latestMonth(opts.cpi) : "",
    minK,
    taxMult: taxMultipliers(db, opts),
  };
}

// Converts an ARS amount into the active value mode. Exported: projections and the
// currency split need it for figures that never pass through a BaseRow.
export function toMode(amountArs: number, month: string, opts: ValueOpts, baseMonth: string): number {
  if (opts.value === "real") return toReal(amountArs, month, baseMonth, opts.cpi);
  if (opts.value === "usd") return amountArs / mepFor(month, opts.mep);
  return amountArs;
}

// The single home of cash/accrual/real/usd/tax semantics. Returns null when the row
// doesn't contribute in this mode (USD-only outside usd mode, or a later cuota in accrual).
function effectiveAmount(r: BaseRow, opts: ValueOpts, ctx: AmountCtx): number | null {
  let cuotaFactor = 1;
  if (opts.spend === "accrual" && r.installment_count != null && r.installment_number != null) {
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}|${r.date ?? ""}`)!;
    if (r.installment_number !== k) return null;
    cuotaFactor = r.installment_count - k + 1; // remaining principal; full price when k=1 (rev note 4)
  }
  const mult = ctx.taxMult.get(r.statement_id) ?? 1;
  if (r.ars == null) {
    // USD-billed row: only usd mode can value it, and its own USD figure is the truth.
    return opts.value === "usd" && r.usd != null ? r.usd * cuotaFactor * mult : null;
  }
  return toMode(r.ars * cuotaFactor * mult, r.month, opts, ctx.baseMonth);
}

export function monthlySpendByCategory(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
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
  const ctx = amountCtx(db, all, opts);
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
  const ctx = amountCtx(db, rows, opts);
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
