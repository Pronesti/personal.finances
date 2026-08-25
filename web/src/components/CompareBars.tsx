"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { fmtArs, fmtPct } from "@/lib/format";

export function CompareBars({ data }: { data: { period: string; amount: number; pctVsPrev: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <XAxis dataKey="period" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtArs(v)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtArs(Number(v))} />
        <Bar dataKey="amount" fill="#0ea5e9">
          <LabelList dataKey="pctVsPrev" position="top" fontSize={11}
            formatter={(v) => (v == null ? "" : fmtPct(Number(v)))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
