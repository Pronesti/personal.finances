"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";

export function CurrencyBars({ data, value }: {
  data: { period: string; arsBilled: number; usdBilled: number }[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="arsBilled" name="ARS-billed" stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar dataKey="usdBilled" name="USD-billed" stackId="1" fill={t.series.secondary} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
