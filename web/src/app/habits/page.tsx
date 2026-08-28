import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { weekdayProfile, ticketTrend } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
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

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Spending habits</h1>
        {/* spend toggle hidden: both charts collapse installment series to their purchase day */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Busiest day</div>
          <div className="text-2xl font-bold">{busiest.day}</div>
          <div className="text-sm text-ink-muted">{weekTotal > 0 ? `${pct((busiest.total / weekTotal) * 100)} of all spend` : "no dated purchases yet"}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Weekend share</div>
          <div className="text-2xl font-bold">{weekTotal > 0 ? pct((weekend / weekTotal) * 100) : "—"}</div>
          <div className="text-sm text-ink-muted">of spend lands on Sat–Sun</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Median ticket</div>
          <div className="text-2xl font-bold">{latestTickets ? fmtMoney(latestTickets.medianTicket, modes.value) : "—"}</div>
          <div className="text-sm text-ink-muted">{latestTickets ? `${latestTickets.period} · ${latestTickets.count} purchases` : "no purchases yet"}</div>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">The shape of a week</h2>
      <WeekdayBars data={dayRows} categories={categories} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        Every purchase in the history, bucketed by the day it was made — an installment plan counts
        once, at full price, on its purchase day. The dashed line is how many purchases each weekday
        has accumulated. Refunds net the bars but are not counted as visits.
      </p>

      <h2 className="mb-3 text-lg font-semibold">Price or volume?</h2>
      <Pills options={GRANULARITIES} current={g} href={x => withModes("/habits", modes, { g: x })} />
      <TicketTrendChart data={tickets} value={modes.value} />
      <p className="mt-3 text-xs text-ink-muted">
        Whether spend moves because of more purchases or bigger ones. Bars count purchases; lines are
        the average and median ticket. In real mode the tickets are inflation-adjusted, so a flat
        median with a rising count is genuinely buying more — not prices dragging the total up. The
        average far above the median means a few big tickets carry the period.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows when you buy and how the size of your purchases changes. The first chart
        divides all purchases by the day of the week. The dashed line counts the purchases of
        each day. The second chart shows the cause when your costs move: more purchases, or
        larger purchases. The bars count purchases. The lines show the average ticket and the
        median ticket. In real mode, a flat median with a count that increases means that you
        buy more things, not that prices push the total up. An average far above the median
        means that some large purchases control the period.
      </p>
    </main>
  );
}
