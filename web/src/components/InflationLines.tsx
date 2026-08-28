"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

export function InflationLines({ data }: { data: { month: string; personal: number; official: number }[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => Math.round(v).toString()} width={60} {...axisProps(t)} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Line type="monotone" dataKey="personal" name={tr("inflation.legend.personal")} stroke={t.series.alert} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="official" name={tr("inflation.legend.official")} stroke={t.series.neutral} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
