"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ALL_PERIOD } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import type { ValueMode, TicketPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

export function TicketTrendChart({ data, value }: { data: TicketPeriod[]; value: ValueMode }) {
  const t = useChartTheme();
  const tr = useT();
  const purchasesName = tr("habits.legend.purchases");
  const periodLabel = (period: unknown) => period === ALL_PERIOD ? tr("granularity.all") : String(period);
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart key={tr.locale} data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" tickFormatter={periodLabel} {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="n" orientation="right" width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          labelFormatter={periodLabel}
          formatter={(v, name) => (name === purchasesName ? String(v) : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="n" dataKey="count" name={purchasesName} fill={t.series.neutral} fillOpacity={0.45} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
        <Line yAxisId="amt" dataKey="avgTicket" name={tr("habits.legend.avgTicket")} stroke={t.series.primary} strokeWidth={2} dot={false} />
        <Line yAxisId="amt" dataKey="medianTicket" name={tr("habits.legend.medianTicket")} stroke={t.series.secondary} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
