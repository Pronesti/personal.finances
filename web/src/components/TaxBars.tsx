"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, TaxPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function TaxBars({ data, value }: { data: TaxPeriod[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const overheadName = tr("taxes.legend.overhead");
  const series: { key: keyof TaxPeriod; name: string; fill: string }[] = [
    { key: "rg5617", name: tr("taxes.legend.rg5617"), fill: t.series.alert },
    { key: "iva", name: tr("taxes.legend.iva"), fill: t.series.primary },
    { key: "iibb", name: tr("taxes.legend.iibb"), fill: t.series.secondary },
    { key: "stampDuty", name: tr("taxes.legend.stampDuty"), fill: t.category.education },
    { key: "interest", name: tr("taxes.legend.interest"), fill: t.series.band },
    { key: "other", name: tr("taxes.legend.other"), fill: t.series.neutral },
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
          formatter={(v, name) => (name === overheadName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        {series.map((s, i) => (
          <Bar key={s.key} yAxisId="amt" dataKey={s.key} name={s.name} stackId="1" fill={s.fill} {...barWidth(data.length)}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
        <Line yAxisId="pct" dataKey="ratePct" name={overheadName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
