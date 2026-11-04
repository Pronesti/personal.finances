"use client";
import { ComposedChart, Area, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function StackedArea({ data, categories, value, labels }: {
  data: Record<string, number | string>[]; categories: string[]; value: ValueMode; labels?: Record<string,string>;
}) {
  const t = useChartTheme();
  const tr = useT();
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
        {categories.map((c,i) => (
          bars
            ? <Bar key={c} dataKey={c} name={labels?.[c] ?? tr(`category.${c as Category}`)} stackId="1" fill={(labels ? Object.values(t.category)[[...c].reduce((n,ch)=>n+ch.charCodeAt(0),0) % Object.values(t.category).length] : Object.entries(t.category).find(([key])=>key===c)?.[1] ?? t.series.primary)} {...barWidth(data.length)} />
            : <Area key={c} type="monotone" dataKey={c} name={labels?.[c] ?? tr(`category.${c as Category}`)} stackId="1"
                stroke={(labels ? Object.values(t.category)[[...c].reduce((n,ch)=>n+ch.charCodeAt(0),0) % Object.values(t.category).length] : Object.entries(t.category).find(([key])=>key===c)?.[1] ?? t.series.primary)} fill={(labels ? Object.values(t.category)[[...c].reduce((n,ch)=>n+ch.charCodeAt(0),0) % Object.values(t.category).length] : Object.entries(t.category).find(([key])=>key===c)?.[1] ?? t.series.primary)} fillOpacity={0.7} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
