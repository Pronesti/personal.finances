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
            className={`rounded-md px-2 py-0.5 transition-colors ${m === month ? "bg-accent text-accent-ink font-medium" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}>{m}</Link>
        ))}
      </div>
      <SankeyFlow data={data} value={modes.value} />
      <p className="text-xs text-ink-muted mt-3">
        Card → category → merchant for one cycle month. Only the top 8 merchants per category get
        their own band; the rest are grouped. Refunds net against their own merchant before the
        flow is drawn, so every category&apos;s inflow equals its outflow.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the flow of money for one cycle month. The flow goes from each card, to
        each category, to each merchant. The goal is to see the structure of one month on one
        screen. Select the month with the pills. The width of a band shows the amount. A wide
        band shows a large cost. Follow a band from left to right to see which merchant receives
        the money. Use this page to find the few large flows that control the month. A month
        with many thin bands has no single large cause.
      </p>
    </main>
  );
}
