"use client";
import { ComposedChart, Bar, Cell, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, MerchantTotal } from "@/lib/queries";
import type { Category } from "@/lib/categorize";
import { useChartTheme, axisProps, tooltipProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

export function ParetoBars({ data, value }: { data: MerchantTotal[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const cumulativeName = tr("merchants.legend.cumulative");
  return (
    <ResponsiveContainer width="100%" height={440}>
      <ComposedChart data={data} margin={{ bottom: 70 }}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis
          dataKey="merchant" interval={0} angle={-40} textAnchor="end"
          {...axisProps(t)} tick={{ fill: t.inkMuted, fontSize: 10 }}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
        />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === cumulativeName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Bar yAxisId="amt" dataKey="total" name={tr("merchants.legend.total")}>
          {data.map(d => (
            <Cell key={d.merchant} fill={t.category[d.category as Category] ?? t.series.neutral} />
          ))}
        </Bar>
        <Line yAxisId="pct" dataKey="cumShare" name={cumulativeName} stroke={t.series.neutral} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
