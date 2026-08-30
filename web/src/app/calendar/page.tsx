import { getDb } from "@/lib/db";
import { dailySpend } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";

export const dynamic = "force-dynamic";

export default async function Calendar({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = dailySpend(getDb(), opts);
  const tr = await getT();
  return (
    <main>
      <CalendarHeatmap data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("calendar.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("calendar.footer")}</p>
    </main>
  );
}
