import { getDb } from "@/lib/db";
import { categoryMovers } from "@/lib/queries";
import { parseModes, parseGranularity, periodWord, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import type { MessageKey } from "@/lib/i18n";
import { fmtMoney, fmtPct } from "@/lib/format";
import { MoverBars } from "@/components/MoverBars";
import { Stat, StatRail } from "@/components/Stat";

export const dynamic = "force-dynamic";

export default async function Movers({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  // "all" collapses history into one bucket — there is no previous period to move against, so
  // this page never offers it and clamps a hand-typed one back to months.
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
      {res == null ? (
        <p className="text-sm text-ink-muted">{tr("movers.empty", { word: periodWord(g, tr.locale) })}</p>
      ) : (
        <>
          <StatRail stats={
            <>
              <Stat
                label={tr("movers.tile.net")}
                value={fmtMoney(curTotal - prevTotal, modes.value)}
                detail={tr("movers.tile.net.detail", {
                  prev: fmtMoney(prevTotal, modes.value), cur: fmtMoney(curTotal, modes.value),
                  pct: prevTotal !== 0 ? fmtPct(((curTotal - prevTotal) / prevTotal) * 100) : "—",
                })}
              />
              <Stat
                label={tr("movers.tile.up")}
                value={up ? catName(up.category) : "—"}
                detail={up ? tr("movers.tile.delta", { amount: fmtMoney(up.delta, modes.value) }) : tr("movers.tile.none")}
              />
              <Stat
                label={tr("movers.tile.down")}
                value={down ? catName(down.category) : "—"}
                detail={down ? tr("movers.tile.delta", { amount: fmtMoney(down.delta, modes.value) }) : tr("movers.tile.none")}
              />
            </>
          }>
            <h2 className="mb-3 text-lg font-semibold">{tr("movers.heading", { prev: res.prevPeriod, cur: res.curPeriod })}</h2>
            {/* Horizontal bars: past a point extra width only stretches the bars, so the chart
                stops where it stays readable. */}
            <div className="max-w-[90rem]">
              <MoverBars data={res.movers} value={modes.value} />
            </div>
            <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">
              {tr("movers.note")}
              {g !== "month" && ` ${tr("movers.partial", { word: periodWord(g, tr.locale) })}`}
            </p>
          </StatRail>
        </>
      )}

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("movers.footer")}</p>
    </main>
  );
}
