"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import type { BankMonth } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

// All three series are monthly percentages, so one axis carries them: the TEM the statement
// prints, CPI month-over-month, and their quotient — what revolving costs in purchasing power.
// Below the zero line, inflation is paying the interest.
export function RateChart({ data }: { data: BankMonth[] }) {
  const t = useChartTheme();
  const tr = useT();
  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => `${v}%`} width={50} {...axisProps(t)} />
        <Tooltip {...tooltipProps(t)} formatter={v => `${Number(v).toFixed(2).replace(".", ",")}%`} />
        <Legend {...legendProps(t)} />
        <ReferenceLine y={0} stroke={t.inkMuted} strokeDasharray="4 4" />
        <Line dataKey="temPct" name={tr("bank.legend.tem")} stroke={t.series.alert} strokeWidth={2} dot={false} />
        <Line dataKey="inflationPct" name={tr("bank.legend.inflation")} stroke={t.series.band} strokeWidth={2} dot={false} />
        <Line dataKey="realTemPct" name={tr("bank.legend.realTem")} stroke={t.series.primary} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
