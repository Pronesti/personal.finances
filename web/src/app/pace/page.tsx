import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { cyclePace } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { PaceChart } from "@/components/PaceChart";

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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("pace.title")}</h1>
        {/* Spend toggle hidden: pace is purchase decisions made inside the cycle window, which
            is the accrual reading by construction. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      {latest == null ? (
        <p className="text-sm text-ink-muted">{tr("pace.empty")}</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("pace.tile.vsTypical")}</div>
              <div className="text-2xl font-bold">{fmtPct(vsTypical)}</div>
              <div className="text-sm text-ink-muted">
                {typicalEnd != null
                  ? tr("pace.tile.vsTypical.detail", { total: fmtMoney(latest.total, modes.value), count: cycles.length - 1 })
                  : tr("pace.tile.vsTypical.none")}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("pace.tile.days")}</div>
              <div className="text-2xl font-bold">{tr("pace.tile.days.value", { days: latest.length })}</div>
              <div className="text-sm text-ink-muted">{tr("pace.tile.days.detail", { month: latest.month })}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("pace.tile.biggestDay")}</div>
              <div className="text-2xl font-bold">{biggest ? fmtMoney(biggest.amount, modes.value) : "—"}</div>
              <div className="text-sm text-ink-muted">{biggest ? tr("pace.tile.biggestDay.detail", { day: biggest.day }) : "—"}</div>
            </div>
          </div>

          <PaceChart cycles={cycles} typical={typical} value={modes.value} />
          <p className="mt-3 text-xs text-ink-muted">{tr("pace.note")}</p>
        </>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("pace.footer")}</p>
    </main>
  );
}
