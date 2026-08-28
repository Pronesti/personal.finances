import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { sankeyFlows, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
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
  const tr = await getT();
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">
          {tr("sankey.title", { period: period === "all" ? tr("sankey.everything") : period })}
        </h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/sankey", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {g !== "all" && (
        <Pills options={periods} current={period} href={p => withModes("/sankey", modes, { g, period: p })} />
      )}
      <SankeyFlow data={data} value={modes.value} />
      <p className="text-xs text-ink-muted mt-3">{tr("sankey.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("sankey.footer")}</p>
    </main>
  );
}
