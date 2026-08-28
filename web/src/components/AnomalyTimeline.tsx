"use client";
import { ComposedChart, CartesianGrid, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, gridProps } from "./chart";

export function AnomalyTimeline({ totals, flaggedPeriods, value }: {
  totals: { period: string; amount: number }[];
  flaggedPeriods: string[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  const flagged = new Set(flaggedPeriods);
  const data = totals.map(x => ({
    period: x.period,
    amount: x.amount,
    flag: flagged.has(x.period) ? x.amount : undefined,
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Line type="monotone" dataKey="amount" stroke={t.series.primary} strokeWidth={2} dot={false} />
        <Scatter dataKey="flag" fill={t.series.alert} shape="circle" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
