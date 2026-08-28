"use client";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function NoveltyBars({ data, value }: {
  data: { period: string; newSpend: number; returningSpend: number; newMerchants: number }[];
  value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  const newName = tr("merchants.legend.new");
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
            return name === newName
              ? tr("merchants.novelty.tooltip", {
                  amount: label,
                  count: (item.payload as { newMerchants: number }).newMerchants,
                })
              : label;
          }}
        />
        <Legend {...legendProps(t)} />
        <Bar dataKey="returningSpend" name={tr("merchants.legend.returning")} stackId="1" fill={t.series.neutral} {...barWidth(data.length)} />
        <Bar dataKey="newSpend" name={newName} stackId="1" fill={t.series.primary} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
