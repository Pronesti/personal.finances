"use client";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";

export function StackedArea({ data, categories, value }: {
  data: Record<string, number | string>[]; categories: Category[]; value: ValueMode;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={420}>
      <AreaChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        {categories.map(c => (
          <Area key={c} type="monotone" dataKey={c} stackId="1"
            stroke={t.category[c]} fill={t.category[c]} fillOpacity={0.7} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
