"use client";
import { ComposedChart, Area, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";

export function StackedArea({ data, categories, value }: {
  data: Record<string, number | string>[]; categories: Category[]; value: ValueMode;
}) {
  const t = useChartTheme();
  // An area needs two points to have a shape: at "all" granularity there is exactly one period,
  // and a stacked area would collapse to a column of dots. Same stack, drawn as a bar instead.
  const bars = data.length < 2;
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        <Legend {...legendProps(t)} />
        {categories.map(c => (
          bars
            ? <Bar key={c} dataKey={c} stackId="1" fill={t.category[c]} {...barWidth(data.length)} />
            : <Area key={c} type="monotone" dataKey={c} stackId="1"
                stroke={t.category[c]} fill={t.category[c]} fillOpacity={0.7} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
