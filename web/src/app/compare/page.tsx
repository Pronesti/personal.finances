import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { periodComparison, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
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
  const tr = await getT();
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("compare.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/compare", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <CompareBars data={data} value={modes.value} />
      {singleCard.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          {tr("compare.warning", { months: singleCard.map(c => c.month).join(", ") })}
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("compare.footer")}</p>
    </main>
  );
}
