"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

export type IndexChartPoint = { label: string; list: number; effective: number };

/** The chained personal index, first receipt = 100: shelf prices vs what was actually paid per unit. */
export function SuperIndexLines({ data }: { data: IndexChartPoint[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="label" {...axisProps(t)} />
        <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} width={50} {...axisProps(t)} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <ReferenceLine y={100} stroke={t.line} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="list" name={tr("super.legend.list")} stroke={t.series.alert} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="effective" name={tr("super.legend.effective")} stroke={t.series.primary} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
