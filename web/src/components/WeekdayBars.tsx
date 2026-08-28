"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";
import type { MessageKey } from "@/lib/i18n";

export function WeekdayBars({ data, categories, value }: {
  data: Record<string, number | string>[]; categories: Category[]; value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  const purchasesName = tr("habits.legend.purchases");
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="day" tickFormatter={(d: string) => tr(`day.${d}` as MessageKey)} {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="n" orientation="right" width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === purchasesName ? String(v) : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        {categories.map((c, i) => (
          <Bar key={c} yAxisId="amt" dataKey={c} name={tr(`category.${c}`)} stackId="1" fill={t.category[c]}
            radius={i === categories.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
        <Line yAxisId="n" dataKey="count" name={purchasesName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
