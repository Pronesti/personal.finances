"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtArs } from "@/lib/format";
import type { FloatPeriod } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth } from "./chart";
import { useT } from "./I18nProvider";

// Always constant base-month pesos — paymentFloat has no value mode, so fmtArs directly.
export function FloatChart({ data }: { data: FloatPeriod[] }) {
  const t = useChartTheme();
  const tr = useT();
  const avgName = tr("float.legend.avg");
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="period" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtArs(v)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="days" orientation="right" tickFormatter={(v: number) => `${v}d`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === avgName ? tr("float.typical.days", { days: Number(v).toFixed(0) }) : fmtArs(Number(v)))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="amt" dataKey="gainOneOff" name={tr("float.legend.oneOff")} stackId="1" fill={t.series.primary} {...barWidth(data.length)} />
        <Bar yAxisId="amt" dataKey="gainInstallment" name={tr("float.legend.installments")} stackId="1" fill={t.series.band} radius={[3, 3, 0, 0]} {...barWidth(data.length)} />
        <Line yAxisId="days" dataKey="avgDays" name={avgName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
