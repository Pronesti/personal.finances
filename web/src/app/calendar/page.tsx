import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { dailySpend } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";

export const dynamic = "force-dynamic";

export default async function Calendar({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = dailySpend(getDb(), opts);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Daily spend</h1>
        {/* No spend toggle: a calendar is always about purchase days, so this page forces accrual. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>
      <CalendarHeatmap data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        Purchase dates, not billing dates. Installment purchases count once at full price on the day
        they were bought — statements re-list them every month at the original date, which would
        otherwise repaint the same day a dozen times. That also means the grid reaches back before
        the first statement: six cuota series were bought in late 2024 and are still being paid off.
        Hover a cell for the total.
      </p>
    </main>
  );
}
