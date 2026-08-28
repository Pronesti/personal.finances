import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { weekdayProfile, ticketTrend } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("habits.title")}</h1>
        {/* spend toggle hidden: both charts collapse installment series to their purchase day */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("habits.busiest")}</div>
          <div className="text-2xl font-bold">{tr(`day.${busiest.day}`)}</div>
          <div className="text-sm text-ink-muted">{weekTotal > 0 ? tr("habits.busiest.detail", { pct: pct((busiest.total / weekTotal) * 100) }) : tr("habits.busiest.none")}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("habits.weekend")}</div>
          <div className="text-2xl font-bold">{weekTotal > 0 ? pct((weekend / weekTotal) * 100) : "—"}</div>
          <div className="text-sm text-ink-muted">{tr("habits.weekend.detail")}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("habits.median")}</div>
          <div className="text-2xl font-bold">{latestTickets ? fmtMoney(latestTickets.medianTicket, modes.value) : "—"}</div>
          <div className="text-sm text-ink-muted">{latestTickets ? tr("habits.median.detail", { period: latestTickets.period, count: latestTickets.count }) : tr("habits.median.none")}</div>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{tr("habits.weekHeading")}</h2>
      <WeekdayBars data={dayRows} categories={categories} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">{tr("habits.weekNote")}</p>

      <h2 className="mb-3 text-lg font-semibold">{tr("habits.ticketHeading")}</h2>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/habits", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <TicketTrendChart data={tickets} value={modes.value} />
      <p className="mt-3 text-xs text-ink-muted">{tr("habits.ticketNote")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("habits.footer")}</p>
    </main>
  );
}
