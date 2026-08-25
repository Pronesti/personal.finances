"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CATEGORY_COLORS } from "@/lib/colors";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

export function DrillBars({ groups, level, value }: {
  groups: { key: string; amount: number }[];
  level: "category" | "subcategory" | "merchant";
  value: ValueMode;
}) {
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
        <XAxis type="number" tickFormatter={(v: number) => fmtMoney(v, value)} fontSize={12} />
        <YAxis type="category" dataKey="key" width={180} fontSize={12} />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
        {/* Recharts' onClick payload typings are unusable; single narrow cast, blame recharts */}
        <Bar dataKey="amount" onClick={(d) => onClick((d as { key: string }).key)} cursor={level === "merchant" ? "default" : "pointer"}>
          {groups.map(g => (
            <Cell key={g.key} fill={CATEGORY_COLORS[g.key as Category] ?? "#0ea5e9"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
