"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, TaxPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";

export function TaxBars({ data, value }: { data: TaxPeriod[]; value: ValueMode }) {
  const t = useChartTheme();
  const series: { key: keyof TaxPeriod; name: string; fill: string }[] = [
    { key: "rg5617", name: "RG 5617 (30% foreign)", fill: t.series.alert },
    { key: "iva", name: "IVA", fill: t.series.primary },
    { key: "iibb", name: "IIBB withholding", fill: t.series.secondary },
    { key: "stampDuty", name: "stamp duty", fill: t.category.education },
    { key: "interest", name: "interest", fill: t.series.band },
    { key: "other", name: "other charges", fill: t.series.neutral },
  ];
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === "overhead" ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        {series.map((s, i) => (
          <Bar key={s.key} yAxisId="amt" dataKey={s.key} name={s.name} stackId="1" fill={s.fill} {...barWidth(data.length)}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
        <Line yAxisId="pct" dataKey="ratePct" name="overhead" stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
