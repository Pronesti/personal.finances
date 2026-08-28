"use client";
import { ComposedChart, Area, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";

type Row = { month: string; certain: number; expected: number; estLow: number; estHigh: number };

export function ProjectionChart({ data, value }: { data: Row[]; value: ValueMode }) {
  const t = useChartTheme();
  // The estimated layer is a band, never a line — honest uncertainty is a stated principle (spec §1).
  const shaped = data.map(d => ({
    ...d,
    bandBase: d.certain + d.expected + d.estLow,
    bandSpan: Math.max(0, d.estHigh - d.estLow),
  }));
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={shaped}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        <Bar dataKey="certain" name="Certain (installments)" stackId="s" fill={t.series.primary} />
        <Bar dataKey="expected" name="Expected (recurring)" stackId="s" fill={t.series.secondary} />
        <Area dataKey="bandBase" stackId="b" stroke="none" fill="none" legendType="none" />
        <Area dataKey="bandSpan" name="Estimated (variable range)" stackId="b"
          stroke={t.series.band} strokeDasharray="4 3" fill={t.series.band} fillOpacity={0.25} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
