import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CompareBars } from "@/components/CompareBars";

export const dynamic = "force-dynamic";

export default async function Compare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
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
      <div className="flex gap-2 mb-4 text-sm">
        {(["month", "quarter", "year"] as const).map(x => (
          <Link key={x} href={withModes("/compare", modes, { g: x })}
            className={`rounded-md px-2 py-0.5 transition-colors ${x === g ? "bg-accent text-accent-ink font-medium" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}>{x}</Link>
        ))}
      </div>
      <CompareBars data={data} value={modes.value} />
      {singleCard.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          ⚠ Single-card months (missing statements for one brand): {singleCard.map(c => c.month).join(", ")} — comparisons across these are apples-to-oranges.
        </p>
      )}
    </main>
  );
}
