import type Database from "better-sqlite3";
import { toReal, latestMonth, monthValue, CPI_REMEDY, type CpiTable } from "@/lib/cpi";
import { mepFor, type MepTable } from "@/lib/mep";
import { detectRecurring, type RecurringCharge } from "@/lib/recurring";
import { detectAnomalies, type Anomaly } from "@/lib/anomalies";
import { project, type ProjectionMonth } from "@/lib/projection";
import { trailingMonthlyInflation } from "@/lib/cpi";
import { addMonth, periodOf, type Granularity } from "@/lib/months";
import { personalInflationIndex, type BasketPoint } from "@/lib/inflation";
import { translate, DEFAULT_LOCALE, type MessageKey, type Vars } from "@/lib/i18n";
import type { Category } from "@/lib/categorize";

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
// doesn't contribute in this mode (USD-only outside usd mode, or a later installment in accrual).
function effectiveAmount(r: BaseRow, opts: ValueOpts, ctx: AmountCtx): number | null {
  let installmentFactor = 1;
  if (opts.spend === "accrual" && r.installment_count != null && r.installment_number != null) {
    const k = ctx.minK.get(`${r.merchant}|${r.installment_count}|${r.date ?? ""}`)!;
    if (r.installment_number !== k) return null;
    installmentFactor = r.installment_count - k + 1; // remaining principal; full price when k=1 (rev note 4)
  }
  const mult = ctx.taxMult.get(r.statement_id) ?? 1;
  if (r.ars == null) {
    // USD-billed row: only usd mode can value it, and its own USD figure is the truth.
    return opts.value === "usd" && r.usd != null ? r.usd * installmentFactor * mult : null;
  }
  return toMode(r.ars * installmentFactor * mult, r.month, opts, ctx.baseMonth);
}

// Summing already-converted amounts across the months of a period is safe in every value mode:
// effectiveAmount() has already put each row in base-month pesos (real), USD, or nominal pesos.
export function spendByCategory(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const key = `${periodOf(r.month, granularity)}|${r.category}`;
    acc.set(key, (acc.get(key) ?? 0) + amt);
  }
  return [...acc.entries()]
    .map(([k, amount]) => { const [period, category] = k.split("|"); return { period, category, amount }; })
    .sort((a, b) => a.period.localeCompare(b.period) || a.category.localeCompare(b.category));
}

export type DrillRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null; amount: number | null; usd: number | null;
};

export function categoryDrill(
  db: Database.Database, opts: ValueOpts,
  filter: {
    category?: string; subcategory?: string; merchant?: string;
    // Scope to one period. `period` is a label produced by periodOf() at this granularity —
    // "2026-07", "2026-Q3" or "2026" — so one filter covers all three time scopes.
    granularity?: Granularity; period?: string;
  }
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
    if (filter.merchant && r.merchant !== filter.merchant) continue;
    if (filter.period && periodOf(r.month, filter.granularity ?? "month") !== filter.period) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null && r.usd == null) continue; // dropped by mode (non-first installment in accrual)
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

export function recurringTable(db: Database.Database, cpi: CpiTable): RecurringCharge[] {
  return detectRecurring(baseRows(db), { cpi });
}

export function periodComparison(
  db: Database.Database, opts: ValueOpts, granularity: Granularity
) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const period = periodOf(r.month, granularity);
    acc.set(period, (acc.get(period) ?? 0) + amt);
  }
  const sorted = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([period, amount], i) => ({
    period, amount,
    // A period can net to zero (purchase fully refunded); a delta against it is undefined, not infinite.
    pctVsPrev: i === 0 || sorted[i - 1][1] === 0 ? null : ((amount - sorted[i - 1][1]) / sorted[i - 1][1]) * 100,
  }));
}

export function coverage(db: Database.Database): { month: string; brands: string[] }[] {
  const rows = db.prepare(
    "SELECT cycle_month AS month, GROUP_CONCAT(DISTINCT brand) AS b FROM statements GROUP BY cycle_month ORDER BY cycle_month"
  ).all() as { month: string; b: string }[];
  return rows.map(r => ({ month: r.month, brands: r.b.split(",").sort() }));
}

export function eli5(db: Database.Database, opts: ValueOpts) {
  const months = spendByCategory(db, opts);
  const sorted = periodTotals(db, opts).map(m => [m.period, m.amount] as [string, number]);
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
  // upcoming_installments stores nominal ARS. Value it the way installmentProjection does: at the
  // latest month seen, not at the future month it falls due — neither CPI nor MEP has data
  // past the last statement. Without this the tile printed raw pesos behind a "US$" sign.
  const baseMonth = latestMonth(opts.cpi);
  const installmentTotal = upcoming.reduce(
    (s, u) => s + toMode(u.amount, lastMonthKey, opts, baseMonth), 0
  );

  const alerts = db.prepare("SELECT kind, message FROM alerts ORDER BY id DESC LIMIT 5")
    .all() as { kind: string; message: string }[];

  const latest = latestPerBrand.sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];

  const openAnomalies = anomalies(db, opts.cpi).filter(a => !a.resolved).slice(0, 5);
  const [next] = installmentProjection(db, opts, 1);
  const nextStatementForecast = next
    ? { certain: next.certain, expected: next.expected, estLow: next.estLow, estHigh: next.estHigh }
    : { certain: 0, expected: 0, estLow: 0, estHigh: 0 };

  return {
    spentThisMonth,
    pctVsPrev: prev ? ((spentThisMonth - prev) / prev) * 100 : null,
    openAnomalies,
    nextStatementForecast,
    topCategories: months.filter(m => m.period === lastMonthKey)
      .sort((a, b) => b.amount - a.amount).slice(0, 3)
      .map(m => ({ category: m.category, amount: m.amount })),
    alerts,
    installmentMonths: upcoming.length,
    installmentTotal,
    sparkline: sorted.slice(-12).map(([month, amount]) => ({ month, amount })),
    latestClosing: latest.closing_date,
    nextDueDate: latest.due_date,
    baseMonth,
  };
}

// Chart 9. Both series land in the active value mode: ARS-billed rows through the normal
// path, USD-billed rows converted at their month's MEP so the split is readable side by side.
export function currencySplit(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, { arsBilled: number; usdBilled: number }>();
  for (const r of rows) {
    // Each USD row is converted at ITS OWN month's MEP before the period sums it, so a
    // quarter never reprices January's travel at March's rate.
    const period = periodOf(r.month, granularity);
    const bucket = acc.get(period) ?? { arsBilled: 0, usdBilled: 0 };
    if (r.ars != null) {
      const amt = effectiveAmount(r, opts, ctx);
      if (amt != null) bucket.arsBilled += amt;
    } else if (r.usd != null) {
      const mult = ctx.taxMult.get(r.statement_id) ?? 1;
      bucket.usdBilled += opts.value === "usd"
        ? r.usd * mult
        : toMode(r.usd * mult * mepFor(r.month, opts.mep), r.month, opts, ctx.baseMonth);
    }
    acc.set(period, bucket);
  }
  return [...acc.entries()]
    .map(([period, v]) => ({ period, ...v }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// Computed per query, never persisted: anomalies depend on the whole history and on CPI,
// so a stored copy would go stale the moment a statement or the CPI table changes.
export function anomalies(db: Database.Database, cpi: CpiTable): Anomaly[] {
  return detectAnomalies(baseRows(db), cpi);
}

export function periodTotals(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
) {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, number>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const period = periodOf(r.month, granularity);
    acc.set(period, (acc.get(period) ?? 0) + amt);
  }
  return [...acc.entries()].map(([period, amount]) => ({ period, amount }))
    .sort((a, b) => a.period.localeCompare(b.period));
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

export function installmentProjection(
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

  // A subscription last charged in 2025 is not a 2027 obligation, and neither is a supermarket
  // that merely shows up every month — detectRecurring now carries both judgements, so the
  // ad-hoc cutoff this used to compute is gone. Low-confidence merchants are not dropped, they
  // fall through to the variable bucket below, which is what they actually are.
  // `currency` is the CURRENT billing currency, so merchants that migrated to USD correctly
  // stop contributing an ARS obligation here.
  const recurring = detectRecurring(rows, { cpi: opts.cpi, latestMonth: latestMonthSeen })
    .filter(r => r.currency === "ARS" && r.status === "active" && r.confidence === "high");
  const recurringNames = new Set(recurring.map(r => r.merchant));
  const recurringMonthly = recurring.reduce(
    (s, r) => s + toMode(r.lastAmount, r.lastMonth, opts, ctx.baseMonth), 0
  );

  // Variable = neither contractual installment nor detected recurring. Trailing 6 cycle months.
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
  // `currencies`, not `currency`: a merchant that billed in ARS for part of its history belongs
  // in an ARS price basket for those months even if it bills in USD today.
  const names = new Set(
    detectRecurring(rows, { cpi }).filter(r => r.currencies.includes("ARS")).map(r => r.merchant)
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

export type SankeyNode = {
  name: string;
  kind: "card" | "category" | "merchant" | "tail";
  /** Set for the two node kinds whose label is a category name, so the UI can translate it. */
  category?: Category;
};

// Chart 2. One netted map keyed brand|category|merchant is the whole trick: deriving both
// link sets from the same survivors makes flow conservation automatic. Accumulating the two
// sides separately and dropping non-positives from each breaks 6 of 19 real months.
export function sankeyFlows(
  db: Database.Database, opts: ValueOpts, period: string, granularity: Granularity = "month"
) {
  const empty = { nodes: [] as SankeyNode[], links: [] as { source: number; target: number; value: number }[] };
  const all = baseRows(db);
  const ctx = amountCtx(db, all, opts);
  const brandByStatement = new Map(
    (db.prepare("SELECT id, brand FROM statements").all() as { id: number; brand: string }[])
      .map(s => [s.id, s.brand])
  );

  const flows = new Map<string, number>(); // "brand|category|merchant" -> netted amount
  for (const r of all) {
    if (periodOf(r.month, granularity) !== period) continue;
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

  // Nodes carry what they are, not just their label: a card brand and a merchant are data and
  // render verbatim, while a category and the grouped tail are copy the page has to translate.
  const nodes: SankeyNode[] = [];
  const idx = (name: string, node: () => SankeyNode) => {
    const at = nodes.findIndex(n => n.name === name);
    return at >= 0 ? at : nodes.push(node()) - 1;
  };
  const cardNode = (brand: string) => idx(brand, () => ({ name: brand, kind: "card" as const }));
  const categoryNode = (category: string) =>
    idx(category, () => ({ name: category, kind: "category" as const, category: category as Category }));
  const merchantNode = (merchant: string) => idx(merchant, () => ({ name: merchant, kind: "merchant" as const }));
  const links: { source: number; target: number; value: number }[] = [];
  for (const [key, value] of brandToCat) {
    const [brand, category] = key.split("|");
    links.push({ source: cardNode(brand), target: categoryNode(category), value });
  }
  for (const [category, merchants] of perCategory) {
    const sorted = [...merchants.entries()].sort((a, b) => b[1] - a[1]);
    for (const [merchant, value] of sorted.slice(0, TOP_MERCHANTS)) {
      links.push({ source: categoryNode(category), target: merchantNode(merchant), value });
    }
    const tail = sorted.slice(TOP_MERCHANTS).reduce((s, [, v]) => s + v, 0);
    if (tail > 0) {
      const label = translate(DEFAULT_LOCALE, "sankey.tail", { category });
      links.push({
        source: categoryNode(category),
        target: idx(label, () => ({ name: label, kind: "tail" as const, category: category as Category })),
        value: tail,
      });
    }
  }
  return { nodes, links };
}

// Chart 3. Always accrual: a calendar answers "what did I buy that day", and installment rows are
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

export type StatementSummary = {
  file: string; brand: string; month: string; closing_date: string;
  transactions: number; alerts: number;
};

export function statementList(db: Database.Database): StatementSummary[] {
  return db.prepare(`
    SELECT s.file, s.brand, s.cycle_month AS month, s.closing_date,
           (SELECT COUNT(*) FROM transactions t WHERE t.statement_id = s.id) AS transactions,
           (SELECT COUNT(*) FROM alerts a WHERE a.statement_id = s.id) AS alerts
    FROM statements s
    ORDER BY s.closing_date DESC, s.brand
  `).all() as StatementSummary[];
}

export type ReviewState = "open" | "reviewed" | "dismissed";

export type ReviewableAlert = {
  key: string;
  source: "integrity" | "anomaly";
  kind: string;
  month: string;
  date: string | null;
  merchant: string | null;
  amount: number | null;
  message: string;
  /** Set only for anomalies. Integrity alerts are stored at ingest and stay in their own words. */
  messageKey?: MessageKey;
  messageParams?: Vars;
  state: ReviewState;
};

// One list, two sources: persisted integrity alerts (ingest-time) and anomalies recomputed per
// request. Keys are stable identity, never a row id and never the alert's prose — checkStatement
// builds its message from the filename and a two-decimal amount, so a rename (which is exactly
// what superseding does) or a one-cent re-parse would orphan the review.
export function reviewableAlerts(db: Database.Database, cpi: CpiTable): ReviewableAlert[] {
  const states = new Map<string, ReviewState>(
    (db.prepare("SELECT key, state FROM alert_reviews").all() as { key: string; state: ReviewState }[])
      .map(r => [r.key, r.state])
  );
  const integrity: ReviewableAlert[] = (db.prepare(`
    SELECT s.brand, s.closing_date, s.cycle_month AS month, a.kind, a.message, a.expected, a.actual
    FROM alerts a JOIN statements s ON s.id = a.statement_id
  `).all() as { brand: string; closing_date: string; month: string; kind: string; message: string; expected: number | null; actual: number | null }[])
    .map(r => {
      const key = `integrity|${r.brand}|${r.closing_date}|${r.kind}|${Math.round(r.expected ?? 0)}`;
      return {
        key, source: "integrity" as const, kind: r.kind, month: r.month, date: null,
        merchant: null, amount: r.actual, message: r.message, state: states.get(key) ?? "open",
      };
    });
  const found: ReviewableAlert[] = anomalies(db, cpi).map(a => {
    // Amounts rounded to whole pesos so a re-parse that shifts a cent does not orphan the review.
    const key = `anomaly|${a.kind}|${a.merchant}|${a.month}|${a.date ?? ""}|${Math.round(a.amount)}`;
    return {
      key, source: "anomaly" as const, kind: a.kind, month: a.month, date: a.date,
      merchant: a.merchant, amount: a.amount,
      // detectAnomalies already spells out "already reversed on the same statement" for a
      // resolved duplicate; repeating it here just doubled the sentence in the table.
      message: a.message,
      messageKey: a.messageKey,
      messageParams: a.messageParams,
      // A duplicate the statement already reversed is closed by the data — until a human says
      // otherwise, which is why an explicit 'open' row is stored rather than the row deleted.
      state: states.get(key) ?? (a.resolved ? "reviewed" : "open"),
    };
  });
  return [...integrity, ...found].sort((a, b) => (b.date ?? b.month).localeCompare(a.date ?? a.month));
}

export function setAlertReview(db: Database.Database, key: string, state: ReviewState): void {
  db.prepare(
    `INSERT INTO alert_reviews (key, state) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET state = excluded.state`
  ).run(key, state);
}

// Alerts legitimately disappear — a new statement moves the new_merchant window, a CPI refresh
// pushes a jump under the threshold, an alias edit renames a merchant. Without this the table
// only ever grows and a stale dismissal is invisible.
export function staleReviews(db: Database.Database, live: ReviewableAlert[]): number {
  const alive = new Set(live.map(a => a.key));
  const keys = (db.prepare("SELECT key FROM alert_reviews").all() as { key: string }[])
    .map(r => r.key).filter(k => !alive.has(k));
  const del = db.prepare("DELETE FROM alert_reviews WHERE key = ?");
  for (const k of keys) del.run(k);
  return keys.length;
}

export type UnknownMerchant = { merchant: string; total: number; count: number };

// Nominal pesos, and negatives NET (inherited decision 2) — ABS() would make a refund increase a
// merchant's queue weight. This is a work queue ordered by "worth naming", not an analysis.
export function unknownMerchants(db: Database.Database): UnknownMerchant[] {
  return db.prepare(`
    SELECT merchant, SUM(COALESCE(ars, 0)) AS total, COUNT(*) AS count
    FROM transactions
    WHERE section = 'purchases' AND category = 'other'
    GROUP BY merchant
    ORDER BY total DESC, merchant
  `).all() as UnknownMerchant[];
}

// Rules match by substring, so accepting "DIA" also claims SOMMIERLANDIA, SOLAR DE LA ABADIA and
// QUOTIDIANO — all real merchants in this dataset. The accept form shows this before the click.
export function rulePreview(db: Database.Database, match: string): { merchant: string; count: number }[] {
  if (match.length < 3) return [];
  return db.prepare(`
    SELECT merchant, COUNT(*) AS count FROM transactions
    WHERE category = 'other' AND section <> 'taxes_and_charges' AND instr(merchant, ?) > 0
    GROUP BY merchant ORDER BY merchant
  `).all(match.toUpperCase()) as { merchant: string; count: number }[];
}

export type MerchantEvidence = {
  count: number;
  firstMonth: string;
  lastMonth: string;
  brands: string[];
  sample: {
    date: string | null; description: string; ars: number | null; usd: number | null;
    installment_number: number | null; installment_count: number | null;
  }[];
};

// Everything the reviewer needs to judge a proposal without leaving the page: how often the
// merchant appears, over which cycle months, on which card, and the raw statement lines
// themselves — the description often carries a locality or product the normalized name lost.
export function merchantEvidence(
  db: Database.Database, merchant: string, sampleSize = 6
): MerchantEvidence | null {
  const agg = db.prepare(`
    SELECT COUNT(*) AS count, MIN(s.cycle_month) AS firstMonth, MAX(s.cycle_month) AS lastMonth
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.merchant = ? AND t.section = 'purchases'
  `).get(merchant) as { count: number; firstMonth: string | null; lastMonth: string | null };
  if (agg.count === 0) return null;
  const brands = (db.prepare(`
    SELECT DISTINCT s.brand FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.merchant = ? AND t.section = 'purchases' ORDER BY s.brand
  `).all(merchant) as { brand: string }[]).map(r => r.brand);
  const sample = db.prepare(`
    SELECT t.date, t.description, t.ars, t.usd, t.installment_number, t.installment_count
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.merchant = ? AND t.section = 'purchases'
    ORDER BY COALESCE(t.date, s.cycle_month) DESC LIMIT ?
  `).all(merchant, sampleSize) as MerchantEvidence["sample"];
  return { count: agg.count, firstMonth: agg.firstMonth!, lastMonth: agg.lastMonth!, brands, sample };
}

export type MerchantTotal = {
  merchant: string; category: string; total: number; count: number;
  firstMonth: string; lastMonth: string; share: number; cumShare: number;
};

// Chart 11. Merchant ranking with cumulative share — "how concentrated is my spending?".
// Unscoped it covers the whole history; `scope` narrows it to one periodOf() label, sharing
// the granularity vocabulary with /categories and /compare. Negatives net per merchant
// (decision 2); a merchant whose scoped history nets ≤ 0 (fully refunded) is dropped rather
// than shown with a negative share. The category shown is the merchant's dominant one — a
// merchant can straddle categories via subcategory rules.
export function merchantConcentration(
  db: Database.Database, opts: ValueOpts,
  scope?: { granularity: Granularity; period: string }
): {
  merchants: MerchantTotal[]; totalSpend: number;
} {
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, opts);
  const acc = new Map<string, {
    total: number; count: number; firstMonth: string; lastMonth: string; byCat: Map<string, number>;
  }>();
  for (const r of rows) {
    if (scope && periodOf(r.month, scope.granularity) !== scope.period) continue;
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const cur = acc.get(r.merchant)
      ?? { total: 0, count: 0, firstMonth: r.month, lastMonth: r.month, byCat: new Map() };
    cur.total += amt;
    cur.count += 1;
    if (r.month < cur.firstMonth) cur.firstMonth = r.month;
    if (r.month > cur.lastMonth) cur.lastMonth = r.month;
    cur.byCat.set(r.category, (cur.byCat.get(r.category) ?? 0) + amt);
    acc.set(r.merchant, cur);
  }
  const positive = [...acc.entries()].filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);
  const totalSpend = positive.reduce((s, [, v]) => s + v.total, 0);
  let cum = 0;
  const merchants = positive.map(([merchant, v]) => {
    cum += v.total;
    const category = [...v.byCat.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      merchant, category, total: v.total, count: v.count,
      firstMonth: v.firstMonth, lastMonth: v.lastMonth,
      share: (v.total / totalSpend) * 100, cumShare: (cum / totalSpend) * 100,
    };
  });
  return { merchants, totalSpend };
}

// Chart 12. Spend split by whether the merchant had ever appeared before its first cycle
// month — "new" stays month-grained even when the bars are bucketed by quarter or year, so
// changing granularity regroups the same judgement rather than redefining it. The first
// covered period is structurally all-new — the page says so instead of hiding it.
export function merchantNovelty(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
): {
  period: string; newSpend: number; returningSpend: number; newMerchants: number;
}[] {
  const rows = baseRows(db); // ordered by cycle_month, so first sighting wins below
  const ctx = amountCtx(db, rows, opts);
  const firstSeen = new Map<string, string>();
  for (const r of rows) if (!firstSeen.has(r.merchant)) firstSeen.set(r.merchant, r.month);
  const acc = new Map<string, { newSpend: number; returningSpend: number; newSet: Set<string> }>();
  for (const r of rows) {
    const amt = effectiveAmount(r, opts, ctx);
    if (amt == null) continue;
    const period = periodOf(r.month, granularity);
    const b = acc.get(period) ?? { newSpend: 0, returningSpend: 0, newSet: new Set<string>() };
    if (firstSeen.get(r.merchant) === r.month) {
      b.newSpend += amt;
      b.newSet.add(r.merchant);
    } else {
      b.returningSpend += amt;
    }
    acc.set(period, b);
  }
  return [...acc.entries()]
    .map(([period, b]) => ({
      period, newSpend: b.newSpend, returningSpend: b.returningSpend, newMerchants: b.newSet.size,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// Chart 13. Always cash: the question is what fraction of each statement was pre-committed by
// past installment decisions before the month even started — accrual would collapse the series back
// to its purchase month and erase exactly that. Value/tax modes still apply. At quarter/year
// granularity, `plans` counts distinct series billed at least once in the period.
export function installmentBurden(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
): {
  period: string; installment: number; oneOff: number; plans: number; sharePct: number;
}[] {
  const cash: ValueOpts = { ...opts, spend: "cash" };
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, cash);
  const acc = new Map<string, { installment: number; oneOff: number; plans: Set<string> }>();
  for (const r of rows) {
    const amt = effectiveAmount(r, cash, ctx);
    if (amt == null) continue;
    const period = periodOf(r.month, granularity);
    const b = acc.get(period) ?? { installment: 0, oneOff: 0, plans: new Set<string>() };
    if (r.installment_count != null) {
      b.installment += amt;
      b.plans.add(`${r.merchant}|${r.installment_count}|${r.date ?? ""}`); // series key, as in amountCtx
    } else {
      b.oneOff += amt;
    }
    acc.set(period, b);
  }
  return [...acc.entries()]
    .map(([period, b]) => ({
      period, installment: b.installment, oneOff: b.oneOff, plans: b.plans.size,
      sharePct: b.installment + b.oneOff > 0 ? (b.installment / (b.installment + b.oneOff)) * 100 : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export type ActivePlan = {
  merchant: string; brand: string; paid: number; total: number;
  monthly: number; remainingMonths: number; remainingTotal: number;
};

// Open installment series as listed on the LATEST statement per brand — the same superseding rule as
// latestStatementIds. remainingTotal assumes the installment stays constant, which AR plans do in
// nominal pesos; upcoming_installments knows the true per-month totals but not the merchant.
export function activePlans(db: Database.Database, opts: ValueOpts): ActivePlan[] {
  const ids = latestStatementIds(db);
  if (ids.length === 0) return [];
  const rows = db.prepare(`
    SELECT s.brand, s.cycle_month AS month, t.merchant, t.date, t.ars,
           t.installment_number AS num, t.installment_count AS cnt
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.statement_id IN (${ids.map(() => "?").join(",")})
      AND t.section = 'purchases' AND t.installment_count IS NOT NULL
      AND t.installment_number < t.installment_count AND t.ars IS NOT NULL
  `).all(...ids) as {
    brand: string; month: string; merchant: string; date: string | null;
    ars: number; num: number; cnt: number;
  }[];
  const baseMonth = opts.value === "real" ? latestMonth(opts.cpi) : "";
  const plans = new Map<string, ActivePlan>();
  for (const r of rows) {
    const key = `${r.brand}|${r.merchant}|${r.cnt}|${r.date ?? ""}`;
    if (plans.has(key)) continue;
    const monthly = toMode(r.ars, r.month, opts, baseMonth);
    plans.set(key, {
      merchant: r.merchant, brand: r.brand, paid: r.num, total: r.cnt,
      monthly, remainingMonths: r.cnt - r.num, remainingTotal: monthly * (r.cnt - r.num),
    });
  }
  return [...plans.values()].sort((a, b) => b.remainingTotal - a.remainingTotal);
}

export type TaxPeriod = {
  period: string; rg5617: number; iva: number; iibb: number; stampDuty: number;
  interest: number; other: number; total: number; ratePct: number | null;
};

type TaxKind = "rg5617" | "iva" | "iibb" | "stampDuty" | "interest" | "other";

function taxKind(desc: string): TaxKind | null {
  if (desc.startsWith("DEVOLUCION")) return null; // balance transfer, not a tax (see taxMultipliers)
  if (desc.includes("RG 5617")) return "rg5617";
  if (desc.includes("IVA")) return "iva";
  if (desc.includes("IIBB")) return "iibb";
  if (desc.includes("SELLOS")) return "stampDuty";
  if (desc.includes("INTERES")) return "interest";
  return "other";
}

// Chart 14. What the card itself costs, by levy, per period. The rate's denominator mirrors
// taxMultipliers: ARS purchases plus USD purchases at MEP, because RG 5617 is levied on the
// foreign spend — an ARS-only base would overstate a travel month's overhead. The rate is a
// nominal ratio (both sides same-month pesos), so it is identical in every value mode; at
// quarter/year granularity each side is summed nominally before dividing, while the displayed
// amounts convert month by month so a real-mode year is honest constant pesos.
export function taxBurden(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
): TaxPeriod[] {
  const taxes = db.prepare(`
    SELECT s.cycle_month AS month, t.description, t.ars
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'taxes_and_charges' AND t.ars IS NOT NULL
  `).all() as { month: string; description: string; ars: number }[];
  const base = db.prepare(`
    SELECT s.cycle_month AS month,
           SUM(CASE WHEN t.ars IS NOT NULL THEN t.ars ELSE 0 END) AS ars_purch,
           SUM(CASE WHEN t.ars IS NULL THEN COALESCE(t.usd, 0) ELSE 0 END) AS usd_purch
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' GROUP BY s.cycle_month
  `).all() as { month: string; ars_purch: number; usd_purch: number }[];
  const baseMonth = opts.value === "real" ? latestMonth(opts.cpi) : "";
  type Bucket = { conv: Record<TaxKind, number>; nominalTax: number; nominalBase: number };
  const acc = new Map<string, Bucket>();
  for (const t of taxes) {
    const kind = taxKind(t.description);
    if (kind == null) continue;
    const period = periodOf(t.month, granularity);
    const b = acc.get(period) ?? {
      conv: { rg5617: 0, iva: 0, iibb: 0, stampDuty: 0, interest: 0, other: 0 },
      nominalTax: 0, nominalBase: 0,
    };
    b.conv[kind] += toMode(t.ars, t.month, opts, baseMonth);
    b.nominalTax += t.ars;
    acc.set(period, b);
  }
  // Second pass so a bucket exists only where taxes do, yet its rate divides by the FULL
  // period's purchases — including the period's tax-free months.
  for (const r of base) {
    const b = acc.get(periodOf(r.month, granularity));
    if (b) b.nominalBase += r.ars_purch + r.usd_purch * mepFor(r.month, opts.mep);
  }
  return [...acc.entries()].map(([period, b]) => ({
    period,
    ...b.conv,
    total: b.conv.rg5617 + b.conv.iva + b.conv.iibb + b.conv.stampDuty + b.conv.interest + b.conv.other,
    ratePct: b.nominalBase > 0 ? (b.nominalTax / b.nominalBase) * 100 : null,
  })).sort((a, b) => a.period.localeCompare(b.period));
}

// Applies a freshly accepted rule to rows already loaded, so the dashboard updates without a full
// re-ingest. The section scope mirrors categorize() exactly — it short-circuits taxes_and_charges
// and runs the rule loop over payments (BONIF PROMO CUOTA XENEIZE is a real, rule-categorized
// payments row) — otherwise this update and `npm run ingest` would disagree.
export function recategorize(
  db: Database.Database, match: string, category: string, subcategory: string | null
): number {
  return db.prepare(
    `UPDATE transactions SET category = ?, subcategory = ?
     WHERE category = 'other' AND section <> 'taxes_and_charges' AND instr(merchant, ?) > 0`
  ).run(category, subcategory, match.toUpperCase()).changes;
}

export type WeekdayRow = {
  /** Monday-first, so the weekend reads as one block at the right edge. */
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  total: number;
  /** Purchases only — a netting refund is not a store visit. */
  count: number;
  byCategory: Record<string, number>;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

// Chart 15. Where the week's money goes, by purchase day. Always accrual for the same reason
// as dailySpend: the question is "what did I buy on Saturdays", and installment rows are
// re-listed by every statement — collapsing a series to its purchase date is the only reading
// under which a weekday means anything.
export function weekdayProfile(db: Database.Database, opts: ValueOpts): WeekdayRow[] {
  const accrual: ValueOpts = { ...opts, spend: "accrual" };
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, accrual);
  const days = DAY_NAMES.map(day => ({ day, total: 0, count: 0, byCategory: {} as Record<string, number> }));
  for (const r of rows) {
    if (r.date == null) continue;
    const amt = effectiveAmount(r, accrual, ctx);
    if (amt == null) continue;
    const d = days[new Date(r.date + "T00:00:00Z").getUTCDay()];
    d.total += amt;
    if (amt > 0) d.count += 1;
    d.byCategory[r.category] = (d.byCategory[r.category] ?? 0) + amt;
  }
  return MONDAY_FIRST.map(i => days[i]);
}

export type TicketPeriod = {
  period: string; count: number; avgTicket: number; medianTicket: number; total: number;
};

// Midpoint median: even-sized samples average the two middles, so a two-purchase month
// doesn't arbitrarily report its pricier half.
function midMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2;
}

// Chart 16. Price-vs-volume decomposition: is spend moving because of MORE purchases or BIGGER
// ones? Always accrual — an installment series is one purchase decision, not six tickets — and
// refunds are excluded outright rather than netted: this is a habits lens, and a refund cancels
// a purchase's cost, not the visit. In real mode the average ticket is inflation-honest, which
// is the whole point: a flat real median with a rising count is volume, the reverse is price.
export function ticketTrend(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month"
): TicketPeriod[] {
  const accrual: ValueOpts = { ...opts, spend: "accrual" };
  const rows = baseRows(db);
  const ctx = amountCtx(db, rows, accrual);
  const acc = new Map<string, number[]>();
  for (const r of rows) {
    const amt = effectiveAmount(r, accrual, ctx);
    if (amt == null || amt <= 0) continue;
    const period = periodOf(r.month, granularity);
    const list = acc.get(period) ?? [];
    list.push(amt);
    acc.set(period, list);
  }
  return [...acc.entries()].map(([period, tickets]) => {
    const total = tickets.reduce((s, x) => s + x, 0);
    return {
      period, count: tickets.length, total,
      avgTicket: total / tickets.length, medianTicket: midMedian(tickets),
    };
  }).sort((a, b) => a.period.localeCompare(b.period));
}

export type CreditKind = "promo" | "refund" | "taxback";

export type CreditPeriod = {
  period: string; promo: number; refund: number; taxback: number; total: number;
  /** Nominal ratio vs the period's positive purchases — identical in every value mode. */
  pctOfSpend: number | null;
};

export type CreditItem = {
  month: string; date: string | null; merchant: string; description: string;
  kind: CreditKind; amount: number;
};

function creditKind(desc: string): CreditKind {
  if (desc.includes("RG 5617")) return "taxback";
  if (desc.includes("BONIF") || desc.includes("OFF")) return "promo";
  return "refund"; // DEVOLUCION and plain merchant reversals
}

// Chart 17. The mirror of /taxes: what the card gave BACK — bank promos (BONIF/Visa Garpa
// lines), merchant refunds, and RG 5617 recovered on foreign-spend reversals. Sources are the
// negative purchase rows (which the spend pages silently net away — decision 2 — so this is
// the one place they are visible) plus payments-section credits, excluding SU PAGO rows, which
// are the user's own money. The rate divides nominal credits by nominal positive purchases,
// same convention as taxBurden's overhead.
export function moneyBack(
  db: Database.Database, opts: ValueOpts, granularity: Granularity = "month", topN = 12
): { periods: CreditPeriod[]; top: CreditItem[] } {
  const credits = db.prepare(`
    SELECT s.cycle_month AS month, t.date, t.description, t.merchant, t.ars
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.ars < 0
      AND (t.section = 'purchases'
           OR (t.section = 'payments' AND t.description NOT LIKE 'SU PAGO%'))
  `).all() as { month: string; date: string | null; description: string; merchant: string; ars: number }[];
  const purchases = db.prepare(`
    SELECT s.cycle_month AS month, SUM(t.ars) AS base
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' AND t.ars > 0 GROUP BY s.cycle_month
  `).all() as { month: string; base: number }[];
  const baseMonth = opts.value === "real" ? latestMonth(opts.cpi) : "";

  type Bucket = { conv: Record<CreditKind, number>; nominal: number; base: number };
  const acc = new Map<string, Bucket>();
  const items: CreditItem[] = [];
  for (const c of credits) {
    const kind = creditKind(c.description);
    const amount = toMode(-c.ars, c.month, opts, baseMonth);
    const period = periodOf(c.month, granularity);
    const b = acc.get(period) ?? { conv: { promo: 0, refund: 0, taxback: 0 }, nominal: 0, base: 0 };
    b.conv[kind] += amount;
    b.nominal += -c.ars;
    acc.set(period, b);
    items.push({ month: c.month, date: c.date, merchant: c.merchant, description: c.description, kind, amount });
  }
  for (const p of purchases) {
    const b = acc.get(periodOf(p.month, granularity));
    if (b) b.base += p.base;
  }
  return {
    periods: [...acc.entries()].map(([period, b]) => ({
      period, ...b.conv,
      total: b.conv.promo + b.conv.refund + b.conv.taxback,
      pctOfSpend: b.base > 0 ? (b.nominal / b.base) * 100 : null,
    })).sort((a, b) => a.period.localeCompare(b.period)),
    top: items.sort((a, b) => b.amount - a.amount).slice(0, topN),
  };
}

export type FloatPeriod = {
  period: string;
  /** Purchase-to-due days, weighted by nominal amount. */
  avgDays: number;
  avgDaysOneOff: number | null;
  avgDaysInstallment: number | null;
  gainOneOff: number;
  gainInstallment: number;
  gain: number;
  /** Gain over the real (purchase-time) value of the month's billed purchases. */
  gainPct: number;
};

// Like monthValue, but a month before the table's start clamps to the first entry instead of
// throwing: an 18-installment plan can carry a purchase date older than the CPI series, and
// "no float gain measurable" is the honest reading there, not a crash.
function cpiAtOrFirst(month: string, cpi: CpiTable): number {
  const months = Object.keys(cpi).sort();
  if (months.length === 0) throw new Error(`CPI table empty — run ${CPI_REMEDY}`);
  return month <= months[0] ? cpi[months[0]] : monthValue(month, cpi, CPI_REMEDY);
}

// Chart 18. What paying LATER in devalued pesos is worth — the card as an inflation subsidy.
// Every billed ARS purchase is paid at its statement's due date; the gain is the difference
// between the real value of those pesos at purchase time and at payment time, in constant
// latest-month pesos. Cash rows by construction (each installment row IS one payment), dated
// by their ORIGINAL purchase date, so a 12-cuota plan earns eleven extra months of float —
// exactly the effect this chart exists to show. USD-billed rows are excluded: their float is a
// MEP bet, not a CPI one. A due month past the CPI table falls back to the latest index, so
// the newest month's gain is understated, never invented.
export function paymentFloat(
  db: Database.Database, cpi: CpiTable, granularity: Granularity = "month"
): FloatPeriod[] {
  const rows = db.prepare(`
    SELECT s.cycle_month AS month, s.due_date, t.date, t.ars,
           t.installment_count IS NOT NULL AS isInstallment
    FROM transactions t JOIN statements s ON s.id = t.statement_id
    WHERE t.section = 'purchases' AND t.ars > 0 AND t.date IS NOT NULL
  `).all() as { month: string; due_date: string | null; date: string; ars: number; isInstallment: 0 | 1 }[];
  const base = latestMonth(cpi);
  type Bucket = {
    days: [number, number]; weight: [number, number]; gain: [number, number]; realAtPurchase: number;
  };
  const acc = new Map<string, Bucket>();
  for (const r of rows) {
    const due = r.due_date ?? `${r.month}-28`; // no due date on file: assume end of cycle month
    const days = (Date.parse(due + "T00:00:00Z") - Date.parse(r.date + "T00:00:00Z")) / 86400_000;
    if (days < 0) continue; // malformed row; a negative float is a parse error, not a loan to the bank
    const realAtPurchase = r.ars * (cpi[base] / cpiAtOrFirst(r.date.slice(0, 7), cpi));
    const realAtDue = r.ars * (cpi[base] / cpiAtOrFirst(due.slice(0, 7), cpi));
    // Bucketing by period rather than by cycle month keeps avgDays a true amount-weighted
    // mean over the whole bucket — the weights are accumulated, never averaged twice.
    const period = periodOf(r.month, granularity);
    const b = acc.get(period)
      ?? { days: [0, 0], weight: [0, 0], gain: [0, 0], realAtPurchase: 0 };
    b.days[r.isInstallment] += days * r.ars;
    b.weight[r.isInstallment] += r.ars;
    b.gain[r.isInstallment] += realAtPurchase - realAtDue;
    b.realAtPurchase += realAtPurchase;
    acc.set(period, b);
  }
  return [...acc.entries()].map(([period, b]) => {
    const weight = b.weight[0] + b.weight[1];
    const gain = b.gain[0] + b.gain[1];
    return {
      period,
      avgDays: (b.days[0] + b.days[1]) / weight,
      avgDaysOneOff: b.weight[0] > 0 ? b.days[0] / b.weight[0] : null,
      avgDaysInstallment: b.weight[1] > 0 ? b.days[1] / b.weight[1] : null,
      gainOneOff: b.gain[0], gainInstallment: b.gain[1], gain,
      gainPct: b.realAtPurchase > 0 ? (gain / b.realAtPurchase) * 100 : 0,
    };
  }).sort((a, b) => a.period.localeCompare(b.period));
}
