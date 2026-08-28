import { getDb } from "@/lib/db";
import { latestMonth, loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { bankTerms, bankBrands } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { BankChart } from "@/components/BankChart";
import { RateChart } from "@/components/RateChart";

export const dynamic = "force-dynamic";

const REAL_WINDOW = 12; // months the "limit in real terms" tile looks back

export default async function Bank({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const months = bankTerms(db, opts);
  const brands = bankBrands(months);
  // Utilization means "of everything the cards allow", so the tile reads the last month with
  // every card's statement on file — the newest cycle often has only one card in yet.
  const latestFull = [...months].reverse().find(m => m.limit != null);
  // The last month whose real rate is COMPUTABLE — the newest cycle usually has a TEM but no
  // CPI yet, and a tile that goes blank for that is less honest than one a month older.
  const latestRated = [...months].reverse().find(m => m.realTemPct != null)
    ?? [...months].reverse().find(m => m.temPct != null);

  // The tile is a real-terms judgement regardless of the active value mode — a nominal limit
  // frozen for a year IS the story, and only constant pesos can say so. It tracks the LARGEST
  // card's own limit: cards from different issuers no longer share a number, and a cross-brand
  // MAX would fake a collapse on any month where only the small card's statement is in.
  const real = bankTerms(db, { spend: "cash", value: "real", tax: "excl", cpi: loadCpi(), mep: loadMep() });
  // Ties on the latest limit (the two BBVA cards share it) go to the longer history: the tile
  // wants the erosion of a standing limit, and the spottier card's series starts at its own
  // introduction, which reads as a raise instead.
  const bigBrand = brands
    .map(b => ({
      b,
      lim: [...real].reverse().find(m => m.limitByBrand[b] != null)?.limitByBrand[b] ?? null,
      span: real.filter(m => m.limitByBrand[b] != null).length,
    }))
    .filter(x => x.lim != null)
    .sort((a, c) => c.lim! - a.lim! || c.span - a.span)[0]?.b;
  const series = bigBrand
    ? real.filter(m => m.limitByBrand[bigBrand] != null).map(m => m.limitByBrand[bigBrand]!)
    : [];
  const last = series.at(-1);
  const back = series.at(-1 - REAL_WINDOW) ?? series[0];
  const realLimitPct = last != null && back != null && series.length > 1 && back > 0
    ? ((last - back) / back) * 100
    : null;
  const windowMonths = series.length > 1 ? Math.min(REAL_WINDOW, series.length - 1) : null;
  const tr = await getT();

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("bank.title")}</h1>
        {/* Spend/tax toggles hidden: limits, balances and rates are statement-header facts —
            no purchase-level accounting view applies to them. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.utilization")}</div>
          <div className="text-2xl font-bold">
            {latestFull?.utilizationPct != null ? `${latestFull.utilizationPct.toFixed(1).replace(".", ",")}%` : "—"}
          </div>
          <div className="text-sm text-ink-muted">
            {latestFull?.balance != null && latestFull?.limit != null
              ? tr("bank.tile.utilization.detail", {
                  balance: fmtMoney(latestFull.balance, modes.value),
                  limit: fmtMoney(latestFull.limit, modes.value),
                  month: latestFull.month,
                })
              : tr("bank.tile.none")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.limitReal")}</div>
          <div className="text-2xl font-bold">{fmtPct(realLimitPct)}</div>
          <div className="text-sm text-ink-muted">
            {windowMonths && bigBrand
              ? tr("bank.tile.limitReal.detail", { brand: bigBrand, months: windowMonths })
              : tr("bank.tile.none")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.realTem")}</div>
          <div className="text-2xl font-bold">
            {latestRated?.realTemPct != null ? tr("bank.tile.realTem.value", { pct: fmtPct(latestRated.realTemPct) }) : "—"}
          </div>
          <div className="text-sm text-ink-muted">
            {latestRated?.temPct != null && latestRated?.inflationPct != null
              ? tr("bank.tile.realTem.detail", {
                  tem: latestRated.temPct.toFixed(2).replace(".", ","),
                  brand: latestRated.temBrand ?? "",
                  infl: latestRated.inflationPct.toFixed(2).replace(".", ","),
                })
              : tr("bank.tile.realTem.stale")}
          </div>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{tr("bank.headroomHeading")}</h2>
      <BankChart data={months} brands={brands} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">{tr("bank.headroomNote")}</p>

      <h2 className="mb-3 text-lg font-semibold">{tr("bank.ratesHeading")}</h2>
      <RateChart data={months} brands={brands} />
      <p className="mt-3 text-xs text-ink-muted">{tr("bank.ratesNote")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("bank.footer")}</p>
    </main>
  );
}
