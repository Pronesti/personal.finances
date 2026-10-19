import { PageGuide } from "@/components/PageGuide";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { dailySpend } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { ModeToggle } from "@/components/ModeToggle";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";

export const dynamic = "force-dynamic";

export default async function Calendar({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = dailySpend(getDb(), opts);
  const tr = await getT();
  return (
    <main>
      <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("calendar.title")}</h1>
        <PageGuide summary={tr("calendar.purpose")} detail={tr("calendar.footer")} />
        {/* No spend toggle: a calendar is always about purchase days, so this page forces accrual. */}
      </div>
      <CalendarHeatmap data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("calendar.note")}</p>
    </main>
  );
}
