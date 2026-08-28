"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, CreditPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function CreditBars({ data, value }: { data: CreditPeriod[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const shareName = tr("credits.legend.share");
  const series: { key: keyof CreditPeriod; name: string; fill: string }[] = [
    { key: "promo", name: tr("credits.legend.promo"), fill: t.series.primary },
    { key: "refund", name: tr("credits.legend.refund"), fill: t.series.secondary },
    { key: "taxback", name: tr("credits.legend.taxback"), fill: t.series.band },
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
          formatter={(v, name) => (name === shareName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        {series.map((s, i) => (
          <Bar key={s.key} yAxisId="amt" dataKey={s.key} name={s.name} stackId="1" fill={s.fill} {...barWidth(data.length)}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
        <Line yAxisId="pct" dataKey="pctOfSpend" name={shareName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
