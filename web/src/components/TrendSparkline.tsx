"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useChartTheme } from "./chart";

/** A unit price over its appearances, inside a table cell. No axes: the row's numbers are the axes. */
export function TrendSparkline({ data }: { data: { label: string; value: number }[] }) {
  const t = useChartTheme();
  return (
    <div className="h-9 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line type="monotone" dataKey="value" stroke={t.series.primary} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
