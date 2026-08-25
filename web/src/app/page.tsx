import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { eli5 } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
import { fmtArs, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Sparkline } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

function Tile({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  const cls = "block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4";
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      {children}
    </>
  );
  return href
    ? <Link href={href} className={`${cls} hover:shadow-md transition-shadow`}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const t = eli5(getDb(), { ...modes, cpi: loadCpi() });
  const valueLabel = modes.value === "real" ? "real" : "nominal";
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Statement {t.latestClosing}</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={t.baseMonth} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Tile href={withModes("/trends", modes)} label={`Spent this statement (${valueLabel})`}>
          <div className="text-2xl font-bold">{fmtArs(t.spentThisMonth)}</div>
          <div className="text-sm text-zinc-500">{fmtPct(t.pctVsPrev)} vs last month</div>
        </Tile>
        <Tile href={withModes("/recurring", modes)} label="Committed next month">
          <div className="text-2xl font-bold">{fmtArs(t.committedNextMonth)}</div>
          <div className="text-sm text-zinc-500">due after {t.nextDueDate ?? "—"}</div>
        </Tile>
        <Tile href={withModes("/categories", modes)} label="Top categories">
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span>{c.category}</span><span>{fmtArs(c.amount)}</span>
            </div>
          ))}
        </Tile>
        <Tile label="Alerts">
          <div className="text-2xl font-bold">{t.alerts.length}</div>
          {t.alerts.length === 0
            ? <div className="text-sm text-zinc-500">statements add up</div>
            : t.alerts.map((a, i) => <div key={i} className="text-xs text-red-600">{a.message}</div>)}
        </Tile>
        <Tile href={withModes("/compare", modes)} label="Cuota burden (both cards)">
          <div className="text-2xl font-bold">{fmtArs(t.cuotaTotal)}</div>
          <div className="text-sm text-zinc-500">over next {t.cuotaMonths} months</div>
        </Tile>
        <Tile href={withModes("/trends", modes)} label={`12-month trend (${valueLabel})`}>
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>
    </main>
  );
}
