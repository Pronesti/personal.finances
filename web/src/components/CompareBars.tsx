"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, gridProps, barWidth } from "./chart";

export function CompareBars({ data, value }: {
  data: { period: string; amount: number; pctVsPrev: number | null }[]; value: ValueMode;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Bar dataKey="amount" fill={t.series.primary} radius={[3, 3, 0, 0]} {...barWidth(data.length)}>
          <LabelList dataKey="pctVsPrev" position="top" fontSize={11} fill={t.inkMuted}
            formatter={(v) => (v == null ? "" : fmtPct(Number(v)))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
