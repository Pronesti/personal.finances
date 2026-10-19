"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, axisProps, tooltipProps, gridProps } from "./chart";
import { useT } from "./I18nProvider";

export function DrillBars({ groups, level, value }: {
  groups: { key: string; amount: number }[];
  level: "category" | "subcategory" | "merchant";
  value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const groupLabel = (key: string) => level === "category" ? tr(`category.${key as Category}`) : key;
  const groupHref = (key: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(level, key);
    return `/categories?${next.toString()}`;
  };
  const onClick = (key: string) => {
    if (level !== "merchant") router.push(groupHref(key));
  };
  return (
    <div className="min-w-0">
    <ResponsiveContainer width="100%" height={Math.max(240, groups.length * 36)}>
      <BarChart data={groups} layout="vertical">
        <CartesianGrid {...gridProps(t)} vertical horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => fmtMoney(v, value)} {...axisProps(t)} />
        {/* Only the top level's keys are category names; below it they are subcategories and
            merchant names, which are data and stay exactly as the statement spelled them. */}
        <YAxis
          type="category" dataKey="key" width={180} {...axisProps(t)}
          tickFormatter={groupLabel}
        />
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
        {/* Recharts' onClick payload typings are unusable; single narrow cast, blame recharts */}
        <Bar dataKey="amount" onClick={(d) => onClick((d as { key: string }).key)} cursor={level === "merchant" ? "default" : "pointer"}>
          {groups.map(g => (
            <Cell key={g.key} fill={t.category[g.key as Category] ?? t.series.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
      <details className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
        <summary className="min-h-8 cursor-pointer font-medium text-accent">{tr("categories.values")}</summary>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {groups.map(g => (
            <li key={g.key}>
              {level === "merchant"
                ? <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"><span>{groupLabel(g.key)}</span><span className="tabular-nums">{fmtMoney(g.amount, value)}</span></div>
                : <Link href={groupHref(g.key)} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
                    <span className="text-accent">{groupLabel(g.key)} <span aria-hidden="true">→</span></span>
                    <span className="tabular-nums">{fmtMoney(g.amount, value)}</span>
                  </Link>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
