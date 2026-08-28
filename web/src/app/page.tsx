import Link from "next/link";
import { getDb } from "@/lib/db";
import { eli5 } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Sparkline } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

function Tile({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  const cls = "block rounded-xl border border-line bg-surface p-4";
  const inner = (
    <>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      {children}
    </>
  );
  return href
    ? <Link href={href} className={`${cls} transition-colors hover:border-line-strong hover:bg-surface-2`}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const t = eli5(getDb(), valueOpts(modes));
  const valueLabel = modes.value === "real" ? "real" : modes.value === "usd" ? "USD" : "nominal";
  const openCount = t.alerts.length + t.openAnomalies.length;
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Statement {t.latestClosing}</h1>
        <ModeToggle modes={modes} baseMonth={t.baseMonth} />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tile href={withModes("/trends", modes)} label={`Spent this statement (${valueLabel})`}>
          <div className="text-2xl font-bold">{fmtMoney(t.spentThisMonth, modes.value)}</div>
          <div className="text-sm text-ink-muted">{fmtPct(t.pctVsPrev)} vs last month</div>
        </Tile>
        <Tile href={withModes("/future", modes)} label="Next statement forecast">
          <div className="text-2xl font-bold">
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estLow, modes.value)}
            {" – "}
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estHigh, modes.value)}
          </div>
          <div className="text-sm text-ink-muted">
            {fmtMoney(t.nextStatementForecast.certain, modes.value)} contractual · due after {t.nextDueDate ?? "—"}
          </div>
        </Tile>
        <Tile href={withModes("/categories", modes)} label="Top categories">
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span className="text-ink-muted">{c.category}</span><span>{fmtMoney(c.amount, modes.value)}</span>
            </div>
          ))}
        </Tile>
        <Tile href={withModes("/anomalies", modes)} label="Alerts">
          <div className={`text-2xl font-bold ${openCount > 0 ? "text-negative" : ""}`}>{openCount}</div>
          {openCount === 0
            ? <div className="text-sm text-ink-muted">statements add up, nothing odd</div>
            : <>
                {t.alerts.map((a, i) => <div key={`a${i}`} className="text-xs text-negative">{a.message}</div>)}
                {t.openAnomalies.map((a, i) => (
                  <div key={`n${i}`} className="text-xs text-negative">{a.merchant}: {a.message}</div>
                ))}
              </>}
        </Tile>
        <Tile href={withModes("/compare", modes)} label="Installment burden (both cards)">
          <div className="text-2xl font-bold">{fmtMoney(t.cuotaTotal, modes.value)}</div>
          <div className="text-sm text-ink-muted">over next {t.cuotaMonths} months</div>
        </Tile>
        <Tile href={withModes("/trends", modes)} label={`12-month trend (${valueLabel})`}>
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows a summary of the latest statement. The goal is to give a fast status of
        your cards. Each tile shows one part of the analysis. Click a tile to open the full page
        for that part. The first tile compares this statement with the last statement. A small
        change is normal. A large increase is a signal. Examine it in Trends. The alert tile is
        good when it shows zero. When it shows more, open the Alerts page and examine each item.
      </p>
    </main>
  );
}
