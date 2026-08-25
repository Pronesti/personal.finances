"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function InflationLines({ data }: { data: { month: string; personal: number; official: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => Math.round(v).toString()} fontSize={12} width={60} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} />
        <Legend />
        <Line type="monotone" dataKey="personal" name="Your basket" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="official" name="INDEC IPC" stroke="#71717a" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
