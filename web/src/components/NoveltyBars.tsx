"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";

export function NoveltyBars({ data, value }: {
  data: { period: string; newSpend: number; returningSpend: number; newMerchants: number }[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name, item) => {
            const label = fmtMoney(Number(v), value);
            return name === "first-time merchants"
              ? `${label} (${(item.payload as { newMerchants: number }).newMerchants} merchants)`
              : label;
          }}
        />
        <Legend {...legendProps(t)} />
        <Bar dataKey="returningSpend" name="returning merchants" stackId="1" fill={t.series.neutral} />
        <Bar dataKey="newSpend" name="first-time merchants" stackId="1" fill={t.series.primary} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
