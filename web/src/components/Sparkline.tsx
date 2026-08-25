"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";

export function Sparkline({ data }: { data: { month: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="amount" stroke="currentColor" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
