"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function InstallmentBurdenChart({ data, value }: {
  data: { period: string; installment: number; oneOff: number; plans: number; sharePct: number }[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  // The tooltip picks the percent series out by its display name, so the label is computed once
  // and reused — a localised name compared against an English literal would never match.
  const shareName = tr("installments.legend.share");
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === shareName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="amt" dataKey="oneOff" name={tr("installments.legend.oneOff")} stackId="1" fill={t.series.neutral} {...barWidth(data.length)} />
        <Bar yAxisId="amt" dataKey="installment" name={tr("installments.legend.installment")} stackId="1" fill={t.series.secondary} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
        <Line yAxisId="pct" dataKey="sharePct" name={shareName} stroke={t.series.band} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
