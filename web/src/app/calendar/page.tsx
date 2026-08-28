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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("calendar.title")}</h1>
        {/* No spend toggle: a calendar is always about purchase days, so this page forces accrual. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
      <CalendarHeatmap data={data} value={modes.value} />
      <p className="text-xs text-ink-muted mt-3">{tr("calendar.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("calendar.footer")}</p>
    </main>
  );
}
