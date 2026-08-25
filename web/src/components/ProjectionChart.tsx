"use client";
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

type Row = { month: string; certain: number; expected: number; estLow: number; estHigh: number };

export function ProjectionChart({ data, value }: { data: Row[]; value: ValueMode }) {
  // The estimated layer is a band, never a line — honest uncertainty is a stated principle (spec §1).
  const shaped = data.map(d => ({
    ...d,
    bandBase: d.certain + d.expected + d.estLow,
    bandSpan: Math.max(0, d.estHigh - d.estLow),
  }));
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={shaped}>
        <XAxis dataKey="month" fontSize={12} />
        <YAxis tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} width={90} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        <Legend />
        <Bar dataKey="certain" name="Certain (cuotas)" stackId="s" fill="#0ea5e9" />
        <Bar dataKey="expected" name="Expected (recurring)" stackId="s" fill="#8b5cf6" />
        <Area dataKey="bandBase" stackId="b" stroke="none" fill="none" legendType="none" />
        <Area dataKey="bandSpan" name="Estimated (variable range)" stackId="b"
          stroke="#f59e0b" strokeDasharray="4 3" fill="#f59e0b" fillOpacity={0.25} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
