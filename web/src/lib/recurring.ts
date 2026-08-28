import { addMonth, monthsBetween } from "@/lib/months";
import { latestMonth, toReal, type CpiTable } from "@/lib/cpi";

export type Currency = "ARS" | "USD";

export type RecurringCharge = {
  merchant: string;
  /** Currency of `lastMonth` — what the merchant bills in *now*. */
  currency: Currency;
  /** Every currency ever seen, sorted. Two entries means billing migrated mid-history. */
  currencies: Currency[];
  occurrences: number;
  firstMonth: string;
  lastMonth: string;
  lastAmount: number;
  /** Null when the previous billed month used a different currency — the ratio would be meaningless. */
  prevAmount: number | null;
  pctChange: number | null;
  /** Billed months skipped between `lastMonth` and the newest month in the data. 0 = current. */
  monthsSinceLast: number;
  status: "active" | "lapsed";
  /**
   * "high" = the amount follows a price, in one of the two ways an Argentine subscription can.
   * "low"  = cadence looks regular but the amount follows neither, the signature of a merchant
   *          simply visited often (supermarket, fuel, tolls). Kept, but not a subscription.
   */
  confidence: "high" | "low";
  /**
   * Which regime earned "high". Null when confidence is "low". Only meaningful for ARS: a USD
   * charge is never deflated, so "indexed" there degenerates to "steady in dollars".
   */
  priceRegime: "pegged" | "indexed" | null;
  /** Null when lapsed — there is no next charge to expect from something that stopped billing. */
  nextExpectedMonth: string | null;
};

type Row = { merchant: string; month: string; ars: number | null; usd: number | null; installment_count?: number | null };

type MonthCell = { amount: number; currency: Currency };

export type DetectOpts = {
  minMonths?: number;
  minDensity?: number;
  /** Billed months that may be skipped before a charge counts as lapsed. */
  maxGap?: number;
  /** Share of consecutive billed months that must hold the same nominal price to read as pegged. */
  minPegFraction?: number;
  /** Ceiling on MAD/median of the CPI-deflated amounts to read as indexed. */
  maxRealMad?: number;
  /** Without it the indexed test cannot run and only the pegged test decides confidence. */
  cpi?: CpiTable;
  /** Newest month the data covers. Defaults to the newest month present in `rows`. */
  latestMonth?: string;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Median absolute deviation over the median. Robust where a standard deviation is not: one
// double-billed month or one off-cycle charge barely moves it, so a long history is not
// disqualified by a single irregular month.
function relativeMad(values: number[]): number {
  const med = median(values);
  if (med <= 0) return Infinity;
  return median(values.map(v => Math.abs(v - med))) / med;
}

/** Share of consecutive months that repeated the previous month's price to within 1%. */
function peggedFraction(values: number[]): number {
  if (values.length < 2) return 0;
  let held = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && Math.abs(values[i] / values[i - 1] - 1) <= 0.01) held += 1;
  }
  return held / (values.length - 1);
}

// An Argentine subscription holds its price in exactly one of two ways, and a single dispersion
// number cannot see both. A PEGGED charge keeps the same nominal figure for months at a time and
// steps when the vendor raises it — steady in pesos, falling in real terms (PRIMEVIDEO, MELI,
// ADOBE). An INDEXED charge is repriced every month against inflation — never the same figure
// twice, but flat once deflated (OSDE, SANCOR, CLUB ATLETICO). Testing only nominal amounts
// drops the indexed ones as history lengthens; testing only real amounts drops the pegged ones.
// A merchant that is merely visited often satisfies neither: its amounts repeat no price and
// track no index.
function classifyRegime(
  nominal: number[], real: number[] | null,
  minPegFraction: number, maxRealMad: number
): "pegged" | "indexed" | null {
  if (peggedFraction(nominal) >= minPegFraction) return "pegged";
  if (real && relativeMad(real) <= maxRealMad) return "indexed";
  return null;
}

// Returns null when the table cannot price every month, so a short or missing CPI table
// disables the indexed test instead of taking down the page that called us.
function deflate(months: string[], nominal: number[], cpi: CpiTable | undefined): number[] | null {
  if (!cpi) return null;
  try {
    const base = latestMonth(cpi);
    return months.map((m, i) => toReal(nominal[i], m, base, cpi));
  } catch {
    return null;
  }
}

export function detectRecurring(rows: Row[], opts: DetectOpts = {}): RecurringCharge[] {
  const {
    minMonths = 4,
    minDensity = 0.6,
    maxGap = 2,
    minPegFraction = 0.25,
    maxRealMad = 0.08,
    cpi,
  } = opts;

  // Grouped by merchant ALONE, not by merchant+currency. Spotify and YouTube Premium moved from
  // ARS to USD billing in 2025-06 with no gap; keyed by currency each showed up twice, once as a
  // live USD row and once as an ARS row frozen at the migration month that looked cancelled.
  const groups = new Map<string, Map<string, MonthCell>>();
  let newestSeen = "";
  for (const r of rows) {
    if (r.installment_count != null) continue;
    let currency: Currency; let amount: number;
    // Negatives ride along and net (rev note 2): a reversed double-charge is one charge,
    // not two, and a fully-reversed month is not an occurrence at all.
    if (r.ars != null) { currency = "ARS"; amount = r.ars; }
    else if (r.usd != null) { currency = "USD"; amount = r.usd; }
    else continue;
    if (r.month > newestSeen) newestSeen = r.month;
    const months = groups.get(r.merchant) ?? new Map<string, MonthCell>();
    const cell = months.get(r.month);
    // A month billed in both currencies has no single total. It does not occur in the real data;
    // when it does, ARS wins the cell (local billing is the one the rest of the app reasons in)
    // and the USD side is dropped rather than summed into a nonsense figure.
    if (!cell) months.set(r.month, { amount, currency });
    else if (cell.currency === currency) cell.amount += amount;
    else if (currency === "ARS") months.set(r.month, { amount, currency });
    groups.set(r.merchant, months);
  }

  const latestMonth = opts.latestMonth ?? newestSeen;
  const out: RecurringCharge[] = [];
  for (const [merchant, months] of groups) {
    const sorted = [...months.keys()].filter(m => months.get(m)!.amount > 0).sort();
    if (sorted.length < minMonths) continue;
    const firstMonth = sorted[0];
    const lastMonth = sorted[sorted.length - 1];
    // Density measures regularity across the months the charge was alive, so a cancelled
    // subscription still reads as having been regular. Recency is `status`'s job, not this ratio's.
    const span = monthsBetween(firstMonth, lastMonth);
    if (sorted.length / span < minDensity) continue;

    const prevMonth = sorted[sorted.length - 2];
    const last = months.get(lastMonth)!;
    const prev = prevMonth ? months.get(prevMonth)! : null;
    const comparablePrev = prev && prev.currency === last.currency ? prev.amount : null;

    const monthsSinceLast = monthsBetween(lastMonth, latestMonth) - 1;
    const status = monthsSinceLast >= maxGap ? "lapsed" : "active";

    // Stability is read only off the months billed in the CURRENT currency. Pesos and dollars
    // are not comparable units, so a merchant that migrated must not have both halves of its
    // history poured into one dispersion figure.
    const priced = sorted.filter(m => months.get(m)!.currency === last.currency);
    const nominal = priced.map(m => months.get(m)!.amount);
    // USD is not what CPI deflates, so for a USD-billed charge nominal already is real.
    const real = last.currency === "USD" ? nominal : deflate(priced, nominal, cpi);
    const priceRegime = classifyRegime(nominal, real, minPegFraction, maxRealMad);

    out.push({
      merchant,
      currency: last.currency,
      currencies: [...new Set(sorted.map(m => months.get(m)!.currency))].sort(),
      occurrences: sorted.length,
      firstMonth, lastMonth,
      lastAmount: last.amount,
      prevAmount: comparablePrev,
      pctChange: comparablePrev ? ((last.amount - comparablePrev) / comparablePrev) * 100 : null,
      monthsSinceLast,
      status,
      confidence: priceRegime ? "high" : "low",
      priceRegime,
      nextExpectedMonth: status === "active" ? addMonth(lastMonth) : null,
    });
  }

  const rank = (r: RecurringCharge) =>
    (r.status === "active" ? 0 : 2) + (r.confidence === "high" ? 0 : 1);
  return out.sort((a, b) =>
    rank(a) - rank(b) ||
    (a.currency === b.currency ? b.lastAmount - a.lastAmount : a.currency === "ARS" ? -1 : 1)
  );
}
