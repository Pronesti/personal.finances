import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { sankeyFlows, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, withModes, valueOpts } from "@/lib/params";
import { periodOf } from "@/lib/months";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { SankeyFlow } from "@/components/SankeyFlow";

export const dynamic = "force-dynamic";

export default async function SankeyPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const g = parseGranularity(sp);
  // coverage() is already in month order, so collapsing to period labels keeps them chronological.
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  // A label from another granularity is not valid here, so switching granularity falls back to
  // the newest period rather than drawing an empty flow.
  const period = typeof sp.period === "string" && periods.includes(sp.period)
    ? sp.period
    : periods.at(-1) ?? "";
  const data = sankeyFlows(db, opts, period, g);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">
          Where {period === "all" ? "everything" : period} went
        </h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills options={GRANULARITIES} current={g} href={x => withModes("/sankey", modes, { g: x })} />
      {g !== "all" && (
        <Pills options={periods} current={period} href={p => withModes("/sankey", modes, { g, period: p })} />
      )}
      <SankeyFlow data={data} value={modes.value} />
      <p className="text-xs text-ink-muted mt-3">
        Card → category → merchant for one period. Only the top 8 merchants per category get
        their own band; the rest are grouped. Refunds net against their own merchant before the
        flow is drawn, so every category&apos;s inflow equals its outflow.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the flow of money for one period. The flow goes from each card, to
        each category, to each merchant. The goal is to see the structure of one period on one
        screen. Select month, quarter, year, or all with the first row of pills, then the period
        itself with the second row. The width of a band shows the amount. A wide
        band shows a large cost. Follow a band from left to right to see which merchant receives
        the money. Use this page to find the few large flows that control the period. A period
        with many thin bands has no single large cause.
      </p>
    </main>
  );
}
