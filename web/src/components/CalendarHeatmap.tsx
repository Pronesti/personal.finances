"use client";
import { useState } from "react";
import Link from "next/link";
import { fmtMoney } from "@/lib/format";
import type { DaySpend, ValueMode } from "@/lib/queries";
import type { MessageKey } from "@/lib/i18n";
import { useChartTheme } from "./chart";
import { useT } from "./I18nProvider";

const CELL = 13, GAP = 2, WEEK = CELL + GAP;

export function CalendarHeatmap({ data, value }: { data: DaySpend[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  if (data.length === 0) return <p className="text-sm text-ink-muted">{tr("calendar.empty")}</p>;
  const max = Math.max(...data.map(d => d.amount));
  const byDate = new Map(data.map(d => [d.date, d]));
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
      cells.push({ x: w * WEEK, y: d * WEEK, date: iso, amount: byDate.get(iso)?.amount ?? 0 });
      if (d === 0) {
        const m = iso.slice(0, 7);
        if (m !== lastMonth) { labels.push({ x: w * WEEK, text: m }); lastMonth = m; }
      }
    }
  }
  const hovered = hover ? byDate.get(hover.date) : undefined;
  const day = selected ? byDate.get(selected) : undefined;
  const catLabel = (c: string) => tr(`category.${c}` as MessageKey);

  // An empty day is drawn, not omitted, so the grid stays a grid. It takes the flat surface
  // colour with a hairline border: a low-opacity ink wash (the old treatment) vanishes on a
  // dark canvas, and anything darker than the canvas reads as a *large* value, not a missing one.
  // The tooltip is a positioned div rather than an SVG <title>: a title cannot hold a list, and
  // the per-category split is the reason to hover at all.
  return (
    <div className="relative">
      <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          // Tooltip lives outside the scroll box (it would be clipped inside), so its anchor is
          // the pointer measured against the outer wrapper, not the cell's SVG coordinates.
          const box = e.currentTarget.parentElement!.getBoundingClientRect();
          setHover(h => h && { ...h, x: e.clientX - box.left, y: e.clientY - box.top });
        }}>
        <svg width={weeks * WEEK + 8} height={7 * WEEK + 22} role="img" aria-label={tr("calendar.aria")}>
          {labels.map(l => (
            <text key={l.text} x={l.x} y={8} fontSize={8} fill={t.inkMuted}>{l.text}</text>
          ))}
          {cells.map(c => (
            <rect key={c.date} x={c.x} y={c.y + 14} width={CELL} height={CELL} rx={2}
              fill={c.amount > 0 ? t.series.primary : t.surface}
              stroke={c.date === selected ? t.ink : t.grid}
              strokeWidth={c.date === selected ? 1.5 : 0.5}
              fillOpacity={c.amount > 0 ? 0.25 + 0.75 * (c.amount / max) : 1}
              style={{ cursor: byDate.has(c.date) ? "pointer" : "default" }}
              onMouseEnter={() => setHover(h => ({ date: c.date, x: h?.x ?? 0, y: h?.y ?? 0 }))}
              onClick={() => byDate.has(c.date) && setSelected(s => (s === c.date ? null : c.date))}>
              <title>{`${c.date}: ${c.amount > 0 ? fmtMoney(c.amount, value) : tr("calendar.noPurchases")}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded border border-line bg-surface px-2 py-1 text-xs shadow"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="font-medium">{hover.date}</div>
          {hovered ? (
            <>
              <div>{fmtMoney(hovered.amount, value)} · {tr.plural("calendar.tip.charges", hovered.count)}</div>
              <ul className="mt-1 text-ink-muted">
                {hovered.categories.map(c => (
                  <li key={c.category}>{catLabel(c.category)}: {c.count} · {fmtMoney(c.amount, value)}</li>
                ))}
              </ul>
              <div className="mt-1 text-ink-subtle">{tr("calendar.tip.click")}</div>
            </>
          ) : <div className="text-ink-muted">{tr("calendar.noPurchases")}</div>}
        </div>
      )}
      {day ? (
        <section className="mt-4 rounded border border-line p-3 text-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">{day.date}</h2>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-accent hover:underline">
              {tr("calendar.day.close")}
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            <dt className="text-ink-muted">{tr("calendar.day.total")}</dt><dd>{fmtMoney(day.amount, value)}</dd>
            <dt className="text-ink-muted">{tr("calendar.day.charges")}</dt><dd>{day.count}</dd>
          </dl>
          <h3 className="mt-3 text-xs text-ink-muted">{tr("calendar.day.categories")}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {day.categories.map(c => (
              <li key={c.category}>{catLabel(c.category)} · {c.count} · {fmtMoney(c.amount, value)}</li>
            ))}
          </ul>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted">
              <th className="py-1">{tr("categories.table.description")}</th>
              <th>{tr("calendar.day.categories")}</th>
              <th>{tr("calendar.day.brand")}</th>
              <th>{tr("calendar.day.statement")}</th>
              <th className="text-right">{tr("categories.table.amount")}</th>
              <th className="text-right">{tr("categories.table.usd")}</th>
            </tr></thead>
            <tbody>
              {day.charges.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1">
                    <span className="block">{r.merchant}</span>
                    <span className="block text-xs text-ink-subtle">{r.description}</span>
                    {r.installmentCount != null && r.installmentCount > 1 && (
                      <span className="block text-xs text-ink-subtle">{tr("calendar.day.installments", { n: r.installmentCount })}</span>
                    )}
                    {r.receiptId !== null && (
                      <Link href={`/receipts/${r.receiptId}`} className="block text-xs text-accent hover:underline">
                        {tr("categories.table.receipt")}
                      </Link>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{catLabel(r.category)}{r.subcategory ? ` / ${r.subcategory}` : ""}</td>
                  <td className="whitespace-nowrap">{r.brand}</td>
                  <td className="whitespace-nowrap">{r.month}</td>
                  <td className="text-right">{r.amount != null ? fmtMoney(r.amount, value) : "—"}</td>
                  <td className="text-right">{r.usd ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="mt-3 text-xs text-ink-subtle">{tr("calendar.day.hint")}</p>
      )}
    </div>
  );
}
