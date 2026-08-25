import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { monthlySpendByCategory } from "@/lib/queries";
import { parseModes } from "@/lib/params";
import type { Category } from "@/lib/categorize";
import { ModeToggle } from "@/components/ModeToggle";
import { StackedArea } from "@/components/StackedArea";

export const dynamic = "force-dynamic";

export default async function Trends({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const cpi = loadCpi();
  const rows = monthlySpendByCategory(getDb(), { ...modes, cpi });
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
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <StackedArea data={[...byMonth.values()]} categories={categories} />
    </main>
  );
}
