"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtArs } from "@/lib/format";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export type SavingsPoint = { label: string; mp: number; coto: number; mixed: number };

/** Who funded the discount on each receipt: the payment method, the shelf, or both at once. */
export function SuperSavingsBars({ data }: { data: SavingsPoint[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="coto" name={tr("super.legend.coto")} stackId="1" fill={t.series.secondary} {...barWidth(data.length)} />
        <Bar dataKey="mp" name={tr("super.legend.mp")} stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar dataKey="mixed" name={tr("super.legend.mixed")} stackId="1" fill={t.series.neutral} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
