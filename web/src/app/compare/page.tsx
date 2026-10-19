import { TableScroll } from "@/components/TableScroll";
import { fmtMoney, fmtPct } from "@/lib/format";
import { PageGuide } from "@/components/PageGuide";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { CompareBars } from "@/components/CompareBars";

export const dynamic = "force-dynamic";

export default async function Compare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const data = periodComparison(db, opts, g);
  const singleCard = coverage(db).filter(c => c.brands.length === 1);
  const tr = await getT();
  return (
    <main>
      <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("compare.title")}</h1>
        <PageGuide summary={tr("compare.purpose")} detail={tr("compare.footer")} />
      </div>
      <Pills groupLabel={tr("period.groupBy")}
        options={GRANULARITIES} current={g}
        href={x => withModes("/compare", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <p className="mb-2 text-xs text-ink-muted">{tr("compare.scrollHint")}</p>
      <div role="region" aria-label={tr("compare.chart")} tabIndex={0} className="max-w-full overflow-x-auto">
        <div style={{ minWidth: Math.max(704, data.length * 64 + 110) }}>
          <CompareBars data={data} value={modes.value} />
        </div>
      </div>
      <details className="mt-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-accent">{tr("compare.values")}</summary>
        <TableScroll label={tr("compare.values")}>
          <table className="w-full min-w-[32rem] text-sm tabular-nums [&_th]:p-2 [&_td]:p-2">
            <thead><tr className="text-left text-ink-muted">
              <th>{tr("compare.period")}</th><th className="text-right">{tr("compare.amount")}</th><th className="text-right">{tr("compare.change")}</th>
            </tr></thead>
            <tbody>{data.map(d => <tr key={d.period} className="border-t border-line">
              <td>{d.period}</td><td className="text-right">{fmtMoney(d.amount, modes.value)}</td><td className="text-right">{fmtPct(d.pctVsPrev)}</td>
            </tr>)}</tbody>
          </table>
        </TableScroll>
      </details>
      {singleCard.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          {tr("compare.warning", { months: singleCard.map(c => c.month).join(", ") })}
        </p>
      )}
    </main>
  );
}
