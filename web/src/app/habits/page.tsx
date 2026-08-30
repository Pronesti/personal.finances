import { getDb } from "@/lib/db";
import { weekdayProfile, ticketTrend } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import { Pills } from "@/components/Pills";
import { Stat, StatRail } from "@/components/Stat";
import { WeekdayBars } from "@/components/WeekdayBars";
import { TicketTrendChart } from "@/components/TicketTrendChart";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Habits({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const days = weekdayProfile(db, opts);
  const tickets = ticketTrend(db, opts, g);

  const weekTotal = days.reduce((s, d) => s + d.total, 0);
  const busiest = days.reduce((a, b) => (b.total > a.total ? b : a));
  const weekend = days.filter(d => d.day === "Sat" || d.day === "Sun").reduce((s, d) => s + d.total, 0);
  const latestTickets = tickets.at(-1);

  const categories = [...new Set(days.flatMap(d => Object.keys(d.byCategory)))].sort() as Category[];
  const dayRows = days.map(d => ({ day: d.day, count: d.count, ...d.byCategory }));
  const tr = await getT();

  return (
    <main>
      <StatRail stats={
        <>
          <Stat
            label={tr("habits.busiest")}
            value={tr(`day.${busiest.day}`)}
            detail={weekTotal > 0 ? tr("habits.busiest.detail", { pct: pct((busiest.total / weekTotal) * 100) }) : tr("habits.busiest.none")}
          />
          <Stat
            label={tr("habits.weekend")}
            value={weekTotal > 0 ? pct((weekend / weekTotal) * 100) : "—"}
            detail={tr("habits.weekend.detail")}
          />
          <Stat
            label={tr("habits.median")}
            value={latestTickets ? fmtMoney(latestTickets.medianTicket, modes.value) : "—"}
            detail={latestTickets ? tr("habits.median.detail", { period: latestTickets.period, count: latestTickets.count }) : tr("habits.median.none")}
          />
        </>
      }>
        {/* Two independent charts: stacked while the column is narrow, side by side once an
            ultrawide rail leaves room for both. */}
        <div className="grid gap-8 3xl:grid-cols-2">
          <section>
            <h2 className="mb-3 text-lg font-semibold">{tr("habits.weekHeading")}</h2>
            <WeekdayBars data={dayRows} categories={categories} value={modes.value} />
            <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("habits.weekNote")}</p>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">{tr("habits.ticketHeading")}</h2>
            {/* Scoped to this chart, not the page — so it stays here rather than in the chrome,
                and owns its own spacing the way any section-level control does. */}
            <div className="mb-4">
              <Pills
                options={GRANULARITIES} current={g}
                href={x => withModes("/habits", modes, { g: x })}
                label={x => granularityLabel(x as Granularity, tr.locale)}
              />
            </div>
            <TicketTrendChart data={tickets} value={modes.value} />
            <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("habits.ticketNote")}</p>
          </section>
        </div>
      </StatRail>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("habits.footer")}</p>
    </main>
  );
}
