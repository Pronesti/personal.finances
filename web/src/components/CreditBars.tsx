"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, CreditPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";

export function CreditBars({ data, value }: { data: CreditPeriod[]; value: ValueMode }) {
  const t = useChartTheme();
  const series: { key: keyof CreditPeriod; name: string; fill: string }[] = [
    { key: "promo", name: "bank promos", fill: t.series.primary },
    { key: "refund", name: "refunds", fill: t.series.secondary },
    { key: "taxback", name: "RG 5617 recovered", fill: t.series.band },
  ];
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === "share of spend" ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        {series.map((s, i) => (
          <Bar key={s.key} yAxisId="amt" dataKey={s.key} name={s.name} stackId="1" fill={s.fill}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
        <Line yAxisId="pct" dataKey="pctOfSpend" name="share of spend" stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
