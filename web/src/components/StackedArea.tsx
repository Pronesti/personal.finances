"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CATEGORY_COLORS } from "@/lib/colors";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function StackedArea({ data, categories, value }: {
  data: Record<string, number | string>[]; categories: Category[]; value: ValueMode;
}) {
  return (
    <ResponsiveContainer width="100%" height={420}>
      <AreaChart data={data}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Legend />
        {categories.map(c => (
          <Area key={c} type="monotone" dataKey={c} stackId="1"
            stroke={CATEGORY_COLORS[c]} fill={CATEGORY_COLORS[c]} fillOpacity={0.7} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
