"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { PaceCycle, PaceDay, ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

// More than a handful of ghost lines stops reading as "context" and starts reading as spaghetti.
const PRIORS_SHOWN = 5;

// The latest cycle's cumulative line against the typical (median) day-by-day path, with the
// last few prior cycles as thin ghosts. Ghost lines stay out of the legend — their tooltip
// entry, named by cycle month, is identification enough.
export function PaceChart({ cycles, typical, value }: {
  cycles: PaceCycle[]; typical: PaceDay[]; value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  const latest = cycles.at(-1);
  const priors = cycles.slice(0, -1).slice(-PRIORS_SHOWN);
  const maxDay = Math.max(
    latest?.length ?? 0, typical.length, ...priors.map(c => c.length)
  );
  const rows: Record<string, number>[] = [];
  for (let d = 1; d <= maxDay; d++) {
    const row: Record<string, number> = { day: d };
    if (latest && d <= latest.length) row.latest = latest.days[d - 1].cum;
    if (d <= typical.length) row.typical = typical[d - 1].cum;
    for (const c of priors) if (d <= c.length) row[c.month] = c.days[d - 1].cum;
    rows.push(row);
  }
  return (
    <ResponsiveContainer width="100%" height={420}>
      <LineChart data={rows}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="day" {...axisProps(t)} label={{ value: tr("pace.axis.day"), position: "insideBottom", offset: -2, fill: t.inkMuted, fontSize: 12 }} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <Tooltip {...tooltipProps(t)} formatter={v => fmtMoney(Number(v), value)} />
        <Legend {...legendProps(t)} />
        {priors.map(c => (
          <Line key={c.month} dataKey={c.month} name={c.month} stroke={t.series.neutral}
            strokeOpacity={0.35} strokeWidth={1.5} dot={false} legendType="none" />
        ))}
        <Line dataKey="typical" name={tr("pace.legend.typical")} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <Line dataKey="latest" name={latest ? tr("pace.legend.latest", { month: latest.month }) : ""} stroke={t.series.primary} strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
