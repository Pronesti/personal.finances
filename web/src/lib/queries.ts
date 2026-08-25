import type Database from "better-sqlite3";
import { toReal, latestMonth, type CpiTable } from "@/lib/cpi";
import { mepFor, type MepTable } from "@/lib/mep";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";
import { detectAnomalies, type Anomaly } from "@/lib/anomalies";
import { project, type ProjectionMonth } from "@/lib/projection";
import { trailingMonthlyInflation } from "@/lib/cpi";
import { addMonth } from "@/lib/months";
import { personalInflationIndex, type BasketPoint } from "@/lib/inflation";

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
  const sorted = monthlyTotals(db, opts).map(m => [m.month, m.amount] as [string, number]);
  if (sorted.length === 0) throw new Error("No statements ingested — run npm run ingest");
  const [lastMonthKey, spentThisMonth] = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2][1] : null;

  const ids = latestStatementIds(db);
  const latestPerBrand = db.prepare(
    `SELECT closing_date, due_date FROM statements WHERE id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids) as { closing_date: string; due_date: string | null }[];
  const upcoming = db.prepare(
    `SELECT month, SUM(amount_ars) amount FROM upcoming_installments
     WHERE statement_id IN (${ids.map(() => "?").join(",")}) GROUP BY month ORDER BY month`
  ).all(...ids) as { month: string; amount: number }[];

  const alerts = db.prepare("SELECT kind, message FROM alerts ORDER BY id DESC LIMIT 5")
    .all() as { kind: string; message: string }[];

  const latest = latestPerBrand.sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];

  const openAnomalies = anomalies(db, opts.cpi).filter(a => !a.resolved).slice(0, 5);
  const [next] = cuotaProjection(db, opts, 1);
  const nextStatementForecast = next
    ? { certain: next.certain, expected: next.expected, estLow: next.estLow, estHigh: next.estHigh }
    : { certain: 0, expected: 0, estLow: 0, estHigh: 0 };

  return {
    spentThisMonth,
    pctVsPrev: prev ? ((spentThisMonth - prev) / prev) * 100 : null,
    openAnomalies,
    nextStatementForecast,
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

// Chart 9. Both series land in the active value mode: ARS-billed rows through the normal
// path, USD-billed rows converted at their month's MEP so the split is readable side by side.
export function currencySplit(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, { arsBilled: number; usdBilled: number }>();
  for (const r of rows) {
    const bucket = acc.get(r.month) ?? { arsBilled: 0, usdBilled: 0 };
    if (r.ars != null) {
      const amt = effectiveAmount(r, opts, ctx);
      if (amt != null) bucket.arsBilled += amt;
    } else if (r.usd != null) {
      const mult = ctx.taxMult.get(r.statement_id) ?? 1;
      bucket.usdBilled += opts.value === "usd"
        ? r.usd * mult
        : toMode(r.usd * mult * mepFor(r.month, opts.mep), r.month, opts, ctx.baseMonth);
    }
    acc.set(r.month, bucket);
  }
  return [...acc.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Computed per query, never persisted: anomalies depend on the whole history and on CPI,
// so a stored copy would go stale the moment a statement or the CPI table changes.
export function anomalies(db: Database.Database, cpi: CpiTable): Anomaly[] {
  return detectAnomalies(baseRows(db), cpi);
}

export function monthlyTotals(db: Database.Database, opts: ValueOpts) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt != null) acc.set(r.month, (acc.get(r.month) ?? 0) + amt);
  }
  return [...acc.entries()].map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Two cards close the same day, and an older statement's installment schedule is superseded
// by the newer one's. LIMIT 1 drops a card; summing all statements double-counts (rev note 7).
export function latestStatementIds(db: Database.Database): number[] {
  return (db.prepare(`
    SELECT s.id FROM statements s
    JOIN (SELECT brand, MAX(closing_date) mc FROM statements GROUP BY brand) x
      ON x.brand = s.brand AND x.mc = s.closing_date
  `).all() as { id: number }[]).map(r => r.id);
}

export function cuotaProjection(
  db: Database.Database, opts: ValueOpts, horizon = 6
): ProjectionMonth[] {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latestMonthSeen = months.at(-1);
  if (!latestMonthSeen) return [];

  const ids = latestStatementIds(db);
  const upcomingRaw = db.prepare(
    `SELECT month, SUM(amount_ars) amount FROM upcoming_installments
     WHERE statement_id IN (${ids.map(() => "?").join(",")}) GROUP BY month ORDER BY month`
  ).all(...ids) as { month: string; amount: number }[];
  const upcoming = upcomingRaw.map(u => ({
    month: u.month,
    amount: toMode(u.amount, latestMonthSeen, opts, ctx.baseMonth),
  }));

  // Recency gate: a subscription last charged in 2025 is not a 2027 obligation. Without it
  // ~87,000 ARS/month of dead merchants ride along, including two that moved to USD billing.
  const cutoff = addMonth(latestMonthSeen, -1);
  const recurring = detectRecurring(rows)
    .filter(r => r.currency === "ARS" && r.lastMonth >= cutoff);
  const recurringNames = new Set(recurring.map(r => r.merchant));
  const recurringMonthly = recurring.reduce(
    (s, r) => s + toMode(r.lastAmount, r.lastMonth, opts, ctx.baseMonth), 0
  );

  // Variable = neither contractual cuota nor detected recurring. Trailing 6 cycle months.
  const trailing = months.slice(-6);
  const variableByMonth = new Map(trailing.map(m => [m, 0]));
  for (const r of rows) {
    if (!variableByMonth.has(r.month)) continue;
    if (r.installment_count != null || recurringNames.has(r.merchant)) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt != null) variableByMonth.set(r.month, variableByMonth.get(r.month)! + amt);
  }

  return project({
    startMonth: addMonth(latestMonthSeen),
    horizon,
    upcoming,
    recurringMonthly,
    variableHistory: [...variableByMonth.values()].filter(v => v > 0),
    inflation: trailingMonthlyInflation(opts.cpi),
    mode: opts.value,
  });
}

// Chart 8. The basket is the user's own detected ARS recurring charges — not a survey basket.
// Restricted to merchants billed once in a month, for the same reason the jump detector is:
// a busier month at the supermarket is volume, not a price rise.
export function personalInflation(
  db: Database.Database, cpi: CpiTable
): { points: BasketPoint[]; basket: string[] } {
  const rows = baseRows(db);
  const names = new Set(
    detectRecurring(rows).filter(r => r.currency === "ARS").map(r => r.merchant)
  );
  const charges = new Map<string, number>();
  for (const r of rows) {
    if (!names.has(r.merchant) || r.ars == null || r.installment_count != null) continue;
    const key = `${r.merchant}|${r.month}`;
    charges.set(key, (charges.get(key) ?? 0) + 1);
  }
  const basketRows: { merchant: string; month: string; ars: number }[] = [];
  for (const r of rows) {
    if (!names.has(r.merchant) || r.ars == null || r.ars <= 0 || r.installment_count != null) continue;
    if (charges.get(`${r.merchant}|${r.month}`) !== 1) continue;
    basketRows.push({ merchant: r.merchant, month: r.month, ars: r.ars });
  }
  return {
    points: personalInflationIndex(basketRows, cpi),
    basket: [...new Set(basketRows.map(r => r.merchant))].sort(),
  };
}

const TOP_MERCHANTS = 8; // per category; the tail becomes one "<category> — other" band

// Chart 2. One netted map keyed brand|category|merchant is the whole trick: deriving both
// link sets from the same survivors makes flow conservation automatic. Accumulating the two
// sides separately and dropping non-positives from each breaks 6 of 19 real months.
export function sankeyFlows(db: Database.Database, opts: ValueOpts, month: string) {
  const empty = { nodes: [] as { name: string }[], links: [] as { source: number; target: number; value: number }[] };
  const all = baseRows(db);
  const ctx = amountCtx(db, all, opts);
  const brandByStatement = new Map(
    (db.prepare("SELECT id, brand FROM statements").all() as { id: number; brand: string }[])
      .map(s => [s.id, s.brand])
  );

  const flows = new Map<string, number>(); // "brand|category|merchant" -> netted amount
  for (const r of all) {
    if (r.month !== month) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue; // negatives ride along and net (rev note 2)
    const brand = brandByStatement.get(r.statement_id) ?? "card";
    const key = `${brand}|${r.category}|${r.merchant}`;
    flows.set(key, (flows.get(key) ?? 0) + amt);
  }
  for (const [k, v] of flows) if (v <= 0) flows.delete(k);
  if (flows.size === 0) return empty;

  const brandToCat = new Map<string, number>();
  const perCategory = new Map<string, Map<string, number>>();
  for (const [k, v] of flows) {
    const [brand, category, merchant] = k.split("|");
    brandToCat.set(`${brand}|${category}`, (brandToCat.get(`${brand}|${category}`) ?? 0) + v);
    const m = perCategory.get(category) ?? new Map<string, number>();
    m.set(merchant, (m.get(merchant) ?? 0) + v); // one merchant, possibly two cards
    perCategory.set(category, m);
  }

  const names: string[] = [];
  const idx = (name: string) => {
    const at = names.indexOf(name);
    return at >= 0 ? at : names.push(name) - 1;
  };
  const links: { source: number; target: number; value: number }[] = [];
  for (const [key, value] of brandToCat) {
    const [brand, category] = key.split("|");
    links.push({ source: idx(brand), target: idx(category), value });
  }
  for (const [category, merchants] of perCategory) {
    const sorted = [...merchants.entries()].sort((a, b) => b[1] - a[1]);
    for (const [merchant, value] of sorted.slice(0, TOP_MERCHANTS)) {
      links.push({ source: idx(category), target: idx(merchant), value });
    }
    const tail = sorted.slice(TOP_MERCHANTS).reduce((s, [, v]) => s + v, 0);
    if (tail > 0) links.push({ source: idx(category), target: idx(`${category} — other`), value: tail });
  }
  return { nodes: names.map(name => ({ name })), links };
}

// Chart 3. Always accrual: a calendar answers "what did I buy that day", and cuota rows are
// re-listed by every statement at their original purchase date (rev note 4 collapses them).
export function dailySpend(db: Database.Database, opts: ValueOpts) {
  const accrual: ValueOpts = { ...opts, spend: "accrual" };
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, accrual);
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.date == null) continue;
    const amt = effectiveAmount(r, accrual, ctx);
    if (amt == null) continue;
    acc.set(r.date, (acc.get(r.date) ?? 0) + amt);
  }
  return [...acc.entries()].map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
