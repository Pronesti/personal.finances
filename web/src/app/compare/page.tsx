import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CompareBars } from "@/components/CompareBars";

export const dynamic = "force-dynamic";

export default async function Compare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
  const db = getDb();
  const cpi = loadCpi();
  const data = periodComparison(db, { ...modes, cpi }, g);
  const singleCard = coverage(db).filter(c => c.brands.length === 1);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Period comparison</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <div className="flex gap-2 mb-4 text-sm">
        {(["month", "quarter", "year"] as const).map(x => (
          <Link key={x} href={withModes("/compare", modes, { g: x })}
            className={x === g ? "font-bold underline" : "hover:underline"}>{x}</Link>
        ))}
      </div>
      <CompareBars data={data} />
      {singleCard.length > 0 && (
        <p className="text-xs text-zinc-500 mt-3">
          ⚠ Single-card months (missing statements for one brand): {singleCard.map(c => c.month).join(", ")} — comparisons across these are apples-to-oranges.
        </p>
      )}
    </main>
  );
}
