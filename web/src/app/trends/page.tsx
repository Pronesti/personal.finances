import { PageGuide } from "@/components/PageGuide";
import { getDb } from "@/lib/db";
import { spendByCategory } from "@/lib/queries";
import { parseModes, parseGranularity, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Category } from "@/lib/categorize";
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
      <div className="mb-6">
        <PageGuide summary={tr("trends.purpose")} detail={tr("trends.footer")} />
      </div>
      <StackedArea data={[...byPeriod.values()]} categories={categories} value={modes.value} />
    </main>
  );
}
