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
      <StackedArea data={[...byPeriod.values()]} categories={categories} value={modes.value} />

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("trends.footer")}</p>
    </main>
  );
}
