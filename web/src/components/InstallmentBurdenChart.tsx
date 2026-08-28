"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";

export function InstallmentBurdenChart({ data, value }: {
  data: { period: string; installment: number; oneOff: number; plans: number; sharePct: number }[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === "installment share" ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="amt" dataKey="oneOff" name="one-off" stackId="1" fill={t.series.neutral} />
        <Bar yAxisId="amt" dataKey="installment" name="installment-billed" stackId="1" fill={t.series.secondary} radius={[3, 3, 0, 0]} />
        <Line yAxisId="pct" dataKey="sharePct" name="installment share" stroke={t.series.band} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
