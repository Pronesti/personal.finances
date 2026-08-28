import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { merchantConcentration, merchantNovelty, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Category } from "@/lib/categorize";
import type { Granularity } from "@/lib/months";
import { periodOf, ALL_PERIOD } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { Stat, StatRail } from "@/components/Stat";
import { ParetoBars } from "@/components/ParetoBars";
import { NoveltyBars } from "@/components/NoveltyBars";

export const dynamic = "force-dynamic";

const TOP_CHART = 20;
const TOP_TABLE = 15;

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Merchants({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  // ALL_PERIOD is the default and the fallback for a period label from another granularity —
  // switching granularity deliberately drops `period` back to the full history.
  const period = typeof sp.period === "string" && periods.includes(sp.period) ? sp.period : ALL_PERIOD;
  const scope = period === ALL_PERIOD ? undefined : { granularity: g, period };
  const { merchants, totalSpend } = merchantConcentration(db, opts, scope);
  const novelty = merchantNovelty(db, opts, g);
  const tr = await getT();
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("merchants.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/merchants", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {/* At "all" granularity every month is already one bucket, so the scope row would offer
          "all" and nothing else — the granularity pill has said it. */}
      {g !== "all" && (
        <Pills
          options={[ALL_PERIOD, ...periods]}
          current={period}
          href={p => withModes("/merchants", modes, p === ALL_PERIOD ? { g } : { g, period: p })}
          label={p => (p === ALL_PERIOD ? granularityLabel("all", tr.locale) : p)}
        />
      )}

      <StatRail stats={
        <>
          <Stat
            label={tr("merchants.count")}
            value={merchants.length}
            detail={period === ALL_PERIOD ? tr("merchants.count.all") : tr("merchants.count.in", { period })}
          />
          <Stat
            label={tr("merchants.top5")}
            value={merchants.length >= 5 ? pct(merchants[4].cumShare) : "—"}
            detail={tr("merchants.top5.detail", { total: fmtMoney(totalSpend, modes.value) })}
          />
          <Stat
            label={tr("merchants.top20")}
            value={merchants.length >= 20 ? pct(merchants[19].cumShare) : "—"}
            detail={tr("merchants.top20.detail")}
          />
        </>
      }>
          {/* Pareto and novelty answer different questions about the same list; on an ultrawide
              column they sit side by side instead of pushing the table below the fold. */}
          <div className="grid gap-8 3xl:grid-cols-2">
            <section>
              <ParetoBars data={merchants.slice(0, TOP_CHART)} value={modes.value} />
              <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("merchants.paretoNote", { count: TOP_CHART })}</p>
            </section>
            <section>
              <h2 className="mb-3 text-lg font-semibold">{tr("merchants.noveltyHeading")}</h2>
              <NoveltyBars data={novelty} value={modes.value} />
              <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("merchants.noveltyNote")}</p>
            </section>
          </div>

        <h2 className="mb-3 mt-8 text-lg font-semibold">{tr("merchants.topHeading", { count: TOP_TABLE })}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
              <th className="py-1 pr-3">{tr("merchants.table.merchant")}</th><th className="pr-3">{tr("merchants.table.category")}</th>
              <th className="pr-3 text-right">{tr("merchants.table.total")}</th><th className="pr-3 text-right">{tr("merchants.table.charges")}</th>
              <th className="pr-3 text-right">{tr("merchants.table.share")}</th><th className="pr-3">{tr("merchants.table.active")}</th>
            </tr>
          </thead>
          <tbody>
            {merchants.slice(0, TOP_TABLE).map(m => (
              <tr key={m.merchant} className="border-t border-line">
                <td className="py-1 pr-3">
                  <Link href={withModes("/categories", modes, { merchant: m.merchant })} className="text-accent hover:underline">
                    {m.merchant}
                  </Link>
                </td>
                <td className="pr-3 text-ink-muted">{tr(`category.${m.category as Category}`)}</td>
                <td className="pr-3 text-right">{fmtMoney(m.total, modes.value)}</td>
                <td className="pr-3 text-right">{m.count}</td>
                <td className="pr-3 text-right">{pct(m.share)}</td>
                <td className="pr-3 text-ink-muted">
                  {m.firstMonth === m.lastMonth ? m.firstMonth : `${m.firstMonth} – ${m.lastMonth}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StatRail>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("merchants.footer")}</p>
    </main>
  );
}
