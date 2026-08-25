"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function CompareBars({ data, value }: {
  data: { period: string; amount: number; pctVsPrev: number | null }[]; value: ValueMode;
}) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <XAxis dataKey="period" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Bar dataKey="amount" fill="#0ea5e9">
          <LabelList dataKey="pctVsPrev" position="top" fontSize={11}
            formatter={(v) => (v == null ? "" : fmtPct(Number(v)))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
