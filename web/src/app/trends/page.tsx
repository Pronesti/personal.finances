import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { monthlySpendByCategory } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import type { Category } from "@/lib/categorize";
import { ModeToggle } from "@/components/ModeToggle";
import { StackedArea } from "@/components/StackedArea";

export const dynamic = "force-dynamic";

export default async function Trends({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const rows = monthlySpendByCategory(getDb(), opts);
  const categories = [...new Set(rows.map(r => r.category))].sort() as Category[];
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { month: r.month };
    m[r.category] = r.amount;
    byMonth.set(r.month, m);
  }
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Monthly spend by category</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <StackedArea data={[...byMonth.values()]} categories={categories} value={modes.value} />

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows your costs for each month, divided by category. The goal is to show how
        your costs change with time. Each colored band is one category. The height of the full
        area is the total of that month. Read the width of a band to see the weight of that
        category. A stable or thin band is good. A band that becomes wider each month is bad. It
        shows a category that grows. Use the real mode to remove the effect of inflation from
        the comparison.
      </p>
    </main>
  );
}
