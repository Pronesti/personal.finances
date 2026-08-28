"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { BankMonth } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, nthSeries } from "./chart";
import { useT } from "./I18nProvider";

// One TEM line per card against CPI month-over-month, all monthly percentages on one axis.
// The real cost of revolving is the GAP between a card's line and the inflation line — a line
// below inflation means inflation pays that card's interest. Brand hues match BankChart via
// nthSeries; the inflation line takes the dashed-ink treatment the other chart gives the
// utilization ratio, so "context series" reads the same way on both.
export function RateChart({ data, brands }: { data: BankMonth[]; brands: string[] }) {
  const t = useChartTheme();
  const tr = useT();
  const rows = data.map(m => ({
    ...m,
    ...Object.fromEntries(brands.map(b => [`tem_${b}`, m.temByBrand[b] ?? null])),
  }));
  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis tickFormatter={(v: number) => `${v}%`} width={50} {...axisProps(t)} />
        <Tooltip {...tooltipProps(t)} formatter={v => `${Number(v).toFixed(2).replace(".", ",")}%`} />
        <Legend {...legendProps(t)} />
        {brands.map((b, i) => (
          <Line key={b} dataKey={`tem_${b}`} name={tr("bank.legend.temBrand", { brand: b })}
            stroke={nthSeries(t, i)} strokeWidth={2} dot={false} />
        ))}
        <Line dataKey="inflationPct" name={tr("bank.legend.inflation")} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
