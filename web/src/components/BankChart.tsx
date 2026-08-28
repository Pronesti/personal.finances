"use client";
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { BankMonth } from "@/lib/queries";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, legendProps, gridProps, barWidth, nthSeries } from "./chart";
import { useT } from "./I18nProvider";

// Headroom: the balance the statements closed with, against each card's own purchase limit,
// with utilization on its own axis — the ratio is nominal, so it survives every value mode.
// One limit line PER BRAND: the cards no longer share a number (BBVA 20M vs Mercado Pago ~5M),
// so any single line would jump with the coverage set rather than with a bank's decision.
// Brand names render verbatim — they are data, not copy.
export function BankChart({ data, brands, value }: {
  data: BankMonth[]; brands: string[]; value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  const utilName = tr("bank.legend.utilization");
  const rows = data.map(m => ({
    ...m,
    ...Object.fromEntries(brands.map(b => [`lim_${b}`, m.limitByBrand[b] ?? null])),
  }));
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={rows}>
        <CartesianGrid {...gridProps(t)} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis yAxisId="amt" tickFormatter={(v: number) => fmtMoney(v, value)} width={90} {...axisProps(t)} />
        <YAxis yAxisId="pct" orientation="right" tickFormatter={(v: number) => `${v}%`} width={45} {...axisProps(t)} />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(v, name) => (name === utilName ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v), value))}
        />
        <Legend {...legendProps(t)} />
        <Bar yAxisId="amt" dataKey="balance" name={tr("bank.legend.balance")} fill={t.series.primary} radius={[3, 3, 0, 0]} {...barWidth(rows.length)} />
        {brands.map((b, i) => (
          <Line key={b} yAxisId="amt" dataKey={`lim_${b}`} name={tr("bank.legend.limitBrand", { brand: b })}
            stroke={nthSeries(t, i)} strokeWidth={2} dot={false} />
        ))}
        <Line yAxisId="pct" dataKey="utilizationPct" name={utilName} stroke={t.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
