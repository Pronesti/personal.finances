import { getDb } from "@/lib/db";
import { cyclePace } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney, fmtPct } from "@/lib/format";
import { PaceChart } from "@/components/PaceChart";
import { Stat, StatRail } from "@/components/Stat";

export const dynamic = "force-dynamic";

export default async function Pace({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const { cycles, typical } = cyclePace(db, opts);
  const latest = cycles.at(-1);
  const typicalEnd = typical.at(-1)?.cum ?? null;
  const vsTypical = latest && typicalEnd ? ((latest.total - typicalEnd) / typicalEnd) * 100 : null;
  // The steepest single step of the latest cycle — the day one purchase (or one shopping run)
  // moved the whole line.
  let biggest: { day: number; amount: number } | null = null;
  if (latest) {
    let prev = 0;
    for (const d of latest.days) {
      const step = d.cum - prev;
      prev = d.cum;
      if (biggest == null || step > biggest.amount) biggest = { day: d.day, amount: step };
    }
  }
  const tr = await getT();

  return (
    <main>
      {latest == null ? (
        <p className="text-sm text-ink-muted">{tr("pace.empty")}</p>
      ) : (
        <>
          <StatRail stats={
            <>
              <Stat
                label={tr("pace.tile.vsTypical")}
                value={fmtPct(vsTypical)}
                detail={typicalEnd != null
                  ? tr("pace.tile.vsTypical.detail", { total: fmtMoney(latest.total, modes.value), count: cycles.length - 1 })
                  : tr("pace.tile.vsTypical.none")}
              />
              <Stat
                label={tr("pace.tile.days")}
                value={tr("pace.tile.days.value", { days: latest.length })}
                detail={tr("pace.tile.days.detail", { month: latest.month })}
              />
              <Stat
                label={tr("pace.tile.biggestDay")}
                value={biggest ? fmtMoney(biggest.amount, modes.value) : "—"}
                detail={biggest ? tr("pace.tile.biggestDay.detail", { day: biggest.day }) : "—"}
              />
            </>
          }>
            <PaceChart cycles={cycles} typical={typical} value={modes.value} />
            <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("pace.note")}</p>
          </StatRail>
        </>
      )}

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("pace.footer")}</p>
    </main>
  );
}
