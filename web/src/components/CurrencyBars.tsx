"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function CurrencyBars({ data, value }: {
  data: { month: string; arsBilled: number; usdBilled: number }[];
  value: ValueMode;
}) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Legend />
        <Bar dataKey="arsBilled" name="ARS-billed" stackId="1" fill="#0ea5e9" />
        <Bar dataKey="usdBilled" name="USD-billed" stackId="1" fill="#8b5cf6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
