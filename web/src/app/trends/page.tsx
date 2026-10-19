import { PageGuide } from "@/components/PageGuide";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { spendByCategory } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import type { Category } from "@/lib/categorize";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { StackedArea } from "@/components/StackedArea";

export const dynamic = "force-dynamic";

export default async function Trends({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const rows = spendByCategory(getDb(), opts, g);
  const tr = await getT();
  const categories = [...new Set(rows.map(r => r.category))].sort() as Category[];
  const byPeriod = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const p = byPeriod.get(r.period) ?? { period: r.period };
    p[r.category] = r.amount;
    byPeriod.set(r.period, p);
  }
  return (
    <main>
      <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("trends.title")}</h1>
        <PageGuide summary={tr("trends.purpose")} detail={tr("trends.footer")} />
      </div>
      <Pills groupLabel={tr("period.groupBy")}
        options={GRANULARITIES} current={g}
        href={x => withModes("/trends", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <StackedArea data={[...byPeriod.values()]} categories={categories} value={modes.value} />
    </main>
  );
}
