"use client";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

const CELL = 13, GAP = 2, WEEK = CELL + GAP;

export function CalendarHeatmap({ data, value }: {
  data: { date: string; amount: number }[]; value: ValueMode;
}) {
  if (data.length === 0) return <p className="text-sm text-zinc-500">No dated purchases.</p>;
  const max = Math.max(...data.map(d => d.amount));
  const byDate = new Map(data.map(d => [d.date, d.amount]));
  const start = new Date(`${data[0].date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // snap back to Sunday
  const end = new Date(`${data[data.length - 1].date}T00:00:00Z`);
  const weeks = Math.ceil((end.getTime() - start.getTime()) / (7 * 86400_000)) + 1;

  const cells: { x: number; y: number; date: string; amount: number }[] = [];
  const labels: { x: number; text: string }[] = [];
  let lastMonth = "";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * 86400_000);
      const iso = day.toISOString().slice(0, 10);
      cells.push({ x: w * WEEK, y: d * WEEK, date: iso, amount: byDate.get(iso) ?? 0 });
      if (d === 0) {
        const m = iso.slice(0, 7);
        if (m !== lastMonth) { labels.push({ x: w * WEEK, text: m }); lastMonth = m; }
      }
    }
  }
  return (
    <div className="overflow-x-auto">
      <svg width={weeks * WEEK + 8} height={7 * WEEK + 22} role="img" aria-label="Daily spend heatmap">
        {labels.map(l => (
          <text key={l.text} x={l.x} y={8} fontSize={8} fill="currentColor" opacity={0.6}>{l.text}</text>
        ))}
        {cells.map(c => (
          <rect key={c.date} x={c.x} y={c.y + 14} width={CELL} height={CELL} rx={2}
            fill={c.amount > 0 ? "#0ea5e9" : "currentColor"}
            fillOpacity={c.amount > 0 ? 0.15 + 0.85 * (c.amount / max) : 0.06}>
            <title>{`${c.date}: ${c.amount > 0 ? fmtMoney(c.amount, value) : "no purchases"}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
