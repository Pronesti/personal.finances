"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useChartTheme } from "./chart";

export function Sparkline({ data }: { data: { month: string; amount: number }[] }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="amount" stroke={t.series.primary} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
