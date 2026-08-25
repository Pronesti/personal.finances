"use client";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function AnomalyTimeline({ totals, flaggedMonths, value }: {
  totals: { month: string; amount: number }[];
  flaggedMonths: string[];
  value: ValueMode;
}) {
  const flagged = new Set(flaggedMonths);
  const data = totals.map(t => ({
    month: t.month,
    amount: t.amount,
    flag: flagged.has(t.month) ? t.amount : undefined,
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Line type="monotone" dataKey="amount" stroke="#0ea5e9" strokeWidth={2} dot={false} />
        <Scatter dataKey="flag" fill="#ef4444" shape="circle" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
