"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { BankMonth } from "@/lib/queries";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

// Headroom: the balance the statements closed with, against the purchase limit the bank set,
// with utilization on its own axis — the ratio is nominal, so it survives every value mode.
// The line draws the PER-CARD limit: the summed limit gaps on every month missing one card's
// statement (most of the Mastercard history), which renders as scattered dots, not a line.
export function BankChart({ data, value }: { data: BankMonth[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const utilName = tr("bank.legend.utilization");
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === utilName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="amt" dataKey="balance" name={tr("bank.legend.balance")} fill={t.series.primary} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
        <Line yAxisId="amt" dataKey="limitCard" name={tr("bank.legend.limit")} stroke={t.series.band} strokeWidth={2} dot={false} />
        <Line yAxisId="pct" dataKey="utilizationPct" name={utilName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
