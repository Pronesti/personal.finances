import Link from "next/link";
import { getDb } from "@/lib/db";
import { eli5 } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { MessageKey } from "@/lib/i18n";
import { fmtMoney, fmtPct } from "@/lib/format";
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
  const tr = await getT();
  const valueLabel = tr(`value.${modes.value}`);
  const openCount = t.alerts.length + t.openAnomalies.length;
  return (
    <main>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 3xl:grid-cols-6">
        <Tile href={withModes("/trends", modes)} label={tr("overview.spent", { value: valueLabel })}>
          <div className="text-2xl font-bold">{fmtMoney(t.spentThisMonth, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("overview.spent.vsPrev", { pct: fmtPct(t.pctVsPrev) })}</div>
        </Tile>
        <Tile href={withModes("/future", modes)} label={tr("overview.forecast")}>
          <div className="text-2xl font-bold">
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estLow, modes.value)}
            {" – "}
            {fmtMoney(t.nextStatementForecast.certain + t.nextStatementForecast.expected + t.nextStatementForecast.estHigh, modes.value)}
          </div>
          <div className="text-sm text-ink-muted">
            {tr("overview.forecast.detail", {
              amount: fmtMoney(t.nextStatementForecast.certain, modes.value),
              date: t.nextDueDate ?? "—",
            })}
          </div>
        </Tile>
        <Tile href={withModes("/categories", modes)} label={tr("overview.topCategories")}>
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span className="text-ink-muted">{tr(`category.${c.category}` as MessageKey)}</span>
              <span>{fmtMoney(c.amount, modes.value)}</span>
            </div>
          ))}
        </Tile>
        <Tile href={withModes("/anomalies", modes)} label={tr("overview.alerts")}>
          <div className={`text-2xl font-bold ${openCount > 0 ? "text-negative" : ""}`}>{openCount}</div>
          {openCount === 0
            ? <div className="text-sm text-ink-muted">{tr("overview.alerts.none")}</div>
            : <>
                {/* Integrity alerts are stored at ingest in the statement's own words — see i18n.ts. */}
                {t.alerts.map((a, i) => <div key={`a${i}`} className="text-xs text-negative">{a.message}</div>)}
                {t.openAnomalies.map((a, i) => (
                  <div key={`n${i}`} className="text-xs text-negative">
                    {a.merchant}: {tr(a.messageKey, a.messageParams)}
                  </div>
                ))}
              </>}
        </Tile>
        <Tile href={withModes("/compare", modes)} label={tr("overview.installments")}>
          <div className="text-2xl font-bold">{fmtMoney(t.installmentTotal, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("overview.installments.detail", { months: t.installmentMonths })}</div>
        </Tile>
        <Tile href={withModes("/trends", modes)} label={tr("overview.trend", { value: valueLabel })}>
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        {tr("overview.footer")}
      </p>
    </main>
  );
}
