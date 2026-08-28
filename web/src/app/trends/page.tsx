import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { spendByCategory } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
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
  const categories = [...new Set(rows.map(r => r.category))].sort() as Category[];
  const byPeriod = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const p = byPeriod.get(r.period) ?? { period: r.period };
    p[r.category] = r.amount;
    byPeriod.set(r.period, p);
  }
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Spend by category</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills options={GRANULARITIES} current={g} href={x => withModes("/trends", modes, { g: x })} />
      <StackedArea data={[...byPeriod.values()]} categories={categories} value={modes.value} />

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows your costs for each period, divided by category. The goal is to show how
        your costs change with time. Each colored band is one category. The height of the full
        area is the total of that period. Read the width of a band to see the weight of that
        category. A stable or thin band is good. A band that becomes wider each month is bad. It
        shows a category that grows. Use the real mode to remove the effect of inflation from
        the comparison. Use the pills to change the period: month, quarter, year, or all, which
        puts the whole history in one column.
      </p>
    </main>
  );
}
