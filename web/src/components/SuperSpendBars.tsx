"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export type SpendPoint = { label: string; paid: number; discount: number };

/** Each receipt as one bar: what was paid, and the discounts on top of it — together, the gross. */
export function SuperSpendBars({ data, value }: { data: SpendPoint[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="paid" name={tr("super.legend.paid")} stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar dataKey="discount" name={tr("super.legend.discount")} stackId="1" fill={t.series.band} fillOpacity={0.7} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
