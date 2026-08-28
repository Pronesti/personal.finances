import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { categoryMovers } from "@/lib/queries";
import { parseModes, parseGranularity, granularityLabel, periodWord, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import type { MessageKey } from "@/lib/i18n";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { MoverBars } from "@/components/MoverBars";

export const dynamic = "force-dynamic";

// "all" collapses history into one bucket — there is no previous period to move against.
const MOVER_GRANULARITIES = ["month", "quarter", "year"] as const;

export default async function Movers({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const parsed = parseGranularity(sp);
  const g: Granularity = parsed === "all" ? "month" : parsed;
  const opts = valueOpts(modes);
  const db = getDb();
  const res = categoryMovers(db, opts, g);
  const tr = await getT();

  const prevTotal = res?.movers.reduce((s, m) => s + m.prev, 0) ?? 0;
  const curTotal = res?.movers.reduce((s, m) => s + m.cur, 0) ?? 0;
  const up = res?.movers[0] && res.movers[0].delta > 0 ? res.movers[0] : null;
  const downCand = res?.movers.at(-1);
  const down = downCand && downCand.delta < 0 ? downCand : null;
  const catName = (c: string) => tr(`category.${c}` as MessageKey);

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("movers.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>

      <Pills
        options={MOVER_GRANULARITIES} current={g}
        href={x => withModes("/movers", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />

      {res == null ? (
        <p className="text-sm text-ink-muted">{tr("movers.empty", { word: periodWord(g, tr.locale) })}</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("movers.tile.net")}</div>
              <div className="text-2xl font-bold">{fmtMoney(curTotal - prevTotal, modes.value)}</div>
              <div className="text-sm text-ink-muted">
                {tr("movers.tile.net.detail", {
                  prev: fmtMoney(prevTotal, modes.value), cur: fmtMoney(curTotal, modes.value),
                  pct: prevTotal !== 0 ? fmtPct(((curTotal - prevTotal) / prevTotal) * 100) : "—",
                })}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("movers.tile.up")}</div>
              <div className="text-2xl font-bold">{up ? catName(up.category) : "—"}</div>
              <div className="text-sm text-ink-muted">{up ? tr("movers.tile.delta", { amount: fmtMoney(up.delta, modes.value) }) : tr("movers.tile.none")}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("movers.tile.down")}</div>
              <div className="text-2xl font-bold">{down ? catName(down.category) : "—"}</div>
              <div className="text-sm text-ink-muted">{down ? tr("movers.tile.delta", { amount: fmtMoney(down.delta, modes.value) }) : tr("movers.tile.none")}</div>
            </div>
          </div>

          <h2 className="mb-3 text-lg font-semibold">{tr("movers.heading", { prev: res.prevPeriod, cur: res.curPeriod })}</h2>
          <MoverBars data={res.movers} value={modes.value} />
          <p className="mt-3 text-xs text-ink-muted">
            {tr("movers.note")}
            {g !== "month" && ` ${tr("movers.partial", { word: periodWord(g, tr.locale) })}`}
          </p>
        </>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("movers.footer")}</p>
    </main>
  );
}
