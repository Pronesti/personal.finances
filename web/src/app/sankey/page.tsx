import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { sankeyFlows, coverage } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { SankeyFlow } from "@/components/SankeyFlow";

export const dynamic = "force-dynamic";

export default async function SankeyPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const months = coverage(db).map(c => c.month);
  const month = typeof sp.month === "string" && months.includes(sp.month)
    ? sp.month
    : months.at(-1) ?? "";
  const data = sankeyFlows(db, opts, month);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Where {month} went</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <div className="flex flex-wrap gap-2 text-sm mb-4">
        {months.map(m => (
          <Link key={m} href={withModes("/sankey", modes, { month: m })}
            className={m === month ? "font-bold underline" : "hover:underline"}>{m}</Link>
        ))}
      </div>
      <SankeyFlow data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        Card → category → merchant for one cycle month. Only the top 8 merchants per category get
        their own band; the rest are grouped. Refunds net against their own merchant before the
        flow is drawn, so every category&apos;s inflow equals its outflow.
      </p>
    </main>
  );
}
