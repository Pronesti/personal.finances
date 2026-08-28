import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, withModes, valueOpts } from "@/lib/params";
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
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Period comparison</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills options={GRANULARITIES} current={g} href={x => withModes("/compare", modes, { g: x })} />
      <CompareBars data={data} value={modes.value} />
      {singleCard.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          ⚠ Single-card months (missing statements for one brand): {singleCard.map(c => c.month).join(", ")} — comparisons across these are apples-to-oranges.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page compares the total cost of each period with the period before it. The goal is
        to show the direction of your costs. Select month, quarter, year, or all with the pills.
        Each bar is one period. The percentage above a bar is the change against the period
        before it, so all — a single bar for the whole history — carries no percentage. Use the
        real mode for this comparison. In real mode, a change near zero is good. It means that your costs are stable. Large changes in sequence show a cost that is
        not under control, or a special event. A period with a missing statement makes its
        comparison not correct. The warning under the chart lists those periods.
      </p>
    </main>
  );
}
