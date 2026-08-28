"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, gridProps } from "./chart";

export function DrillBars({ groups, level, value }: {
  groups: { key: string; amount: number }[];
  level: "category" | "subcategory" | "merchant";
  value: ValueMode;
}) {
  const t = useChartTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const onClick = (key: string) => {
    if (level === "merchant") return;
    const next = new URLSearchParams(sp.toString());
    next.set(level, key);
    router.push(`/categories?${next.toString()}`);
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, groups.length * 36)}>
      <BarChart data={groups} layout="vertical">
        <CartesianGrid {...gridProps(t)} vertical horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => fmtMoney(v, value)} {...axisProps(t)} />
        <YAxis type="category" dataKey="key" width={180} {...axisProps(t)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        {/* Recharts' onClick payload typings are unusable; single narrow cast, blame recharts */}
        <Bar dataKey="amount" onClick={(d) => onClick((d as { key: string }).key)} cursor={level === "merchant" ? "default" : "pointer"}>
          {groups.map(g => (
            <Cell key={g.key} fill={t.category[g.key as Category] ?? t.series.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
