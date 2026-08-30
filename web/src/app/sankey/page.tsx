import { getDb } from "@/lib/db";
import { sankeyFlows, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, valueOpts, periodsFor, resolvePeriod } from "@/lib/params";
import { getT } from "@/lib/locale";
import { SankeyFlow } from "@/components/SankeyFlow";

export const dynamic = "force-dynamic";

export default async function SankeyPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const g = parseGranularity(sp);
  // The same two functions the chrome uses, so the page and its period pills can never disagree
  // about which period is selected.
  const period = resolvePeriod(periodsFor(coverage(db).map(c => c.month), g), sp.period, "latest");
  const data = sankeyFlows(db, opts, period, g);
  const tr = await getT();
  return (
    <main>
      <SankeyFlow data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("sankey.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("sankey.footer")}</p>
    </main>
  );
}
