"use client";
import { BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { Mover, ValueMode } from "@/lib/queries";
import type { MessageKey } from "@/lib/i18n";
import { useChartTheme, axisProps, tooltipProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

// Diverging bars, one per category, sorted by how hard each pushed the total. Red right of
// zero is a category that grew, blue left of zero is one that shrank — neither is moralized,
// the tooltip carries the actual before/after pair.
export function MoverBars({ data, value }: { data: Mover[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const rows = data.map(m => ({ ...m, label: tr(`category.${m.category}` as MessageKey) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 40 + 60)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid {...gridProps(t)} vertical horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => fmtMoney(v, value)} {...axisProps(t)} />
        <YAxis type="category" dataKey="label" width={110} {...axisProps(t)} tickLine={false} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, _n, item) => {
            const m = item.payload as Mover;
            const pct = m.pctChange == null ? tr("movers.new") : fmtPct(m.pctChange);
            return [
              `${fmtMoney(Number(v), value)} — ${fmtMoney(m.prev, value)} → ${fmtMoney(m.cur, value)} (${pct})`,
              tr("movers.legend.delta"),
            ];
          }}
        />
        <ReferenceLine x={0} stroke={t.inkMuted} />
        <Bar dataKey="delta" radius={[0, 3, 3, 0]}>
          {rows.map(m => (
            <Cell key={m.category} fill={m.delta >= 0 ? t.series.alert : t.series.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
