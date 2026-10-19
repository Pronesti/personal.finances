import Link from "next/link";
import { getDb } from "@/lib/db";
import { eli5 } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { MessageKey } from "@/lib/i18n";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Sparkline } from "@/components/Sparkline";

export const dynamic = "force-dynamic";

function Tile({ href, label, children, action }: { href?: string; label: string; action: string; children: React.ReactNode }) {
  const cls = "flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 sm:p-6";
  const inner = (
    <>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="flex-1">{children}</div>
      <div className="mt-5 border-t border-line pt-3 text-sm font-medium text-accent">{action} <span aria-hidden="true">→</span></div>
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
  const openCount = t.openAlerts.length;
  return (
    <main>
      <ModeToggle modes={modes} baseMonth={t.baseMonth} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">{tr("overview.title", { date: t.latestClosing })}</h1><p className="mt-2 text-sm text-ink-muted">{tr("overview.intro")}</p></div>
      </div>
      <section className="mb-6 rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{tr("overview.next")}</h2>
        <div className="flex flex-wrap gap-3">
          {([["/categories", "overview.action.spend"], ["/future", "overview.action.future"], ["/upload", "overview.action.upload"]] as const).map(([href, key]) => <Link key={href} href={withModes(href, modes)} className="inline-flex min-h-11 items-center rounded-lg bg-accent-soft px-4 text-sm font-medium text-accent hover:underline">{tr(key)} <span className="ml-3" aria-hidden="true">→</span></Link>)}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile action={tr("overview.explore")} href={withModes("/trends", modes)} label={tr("overview.spent", { value: valueLabel })}>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{fmtMoney(t.spentThisMonth, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("overview.spent.vsPrev", { pct: fmtPct(t.pctVsPrev) })}</div>
        </Tile>
        <Tile action={tr("overview.explore")} href={withModes("/future", modes)} label={tr("overview.forecast")}>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
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
        <Tile action={tr("overview.explore")} href={withModes("/categories", modes)} label={tr("overview.topCategories")}>
          {t.topCategories.map(c => (
            <div key={c.category} className="flex justify-between text-sm">
              <span className="text-ink-muted">{tr(`category.${c.category}` as MessageKey)}</span>
              <span>{fmtMoney(c.amount, modes.value)}</span>
            </div>
          ))}
        </Tile>
        <Tile action={tr("overview.explore")} href={withModes("/anomalies", modes)} label={tr("overview.alerts")}>
          <div className={`text-2xl font-semibold tracking-tight tabular-nums ${openCount > 0 ? "text-negative" : ""}`}>{openCount}</div>
          {openCount === 0
            ? <div className="text-sm text-ink-muted">{tr("overview.alerts.none")}</div>
            : <>
                {t.openAlerts.slice(0, 2).map(a => (
                  <div key={a.key} className="mt-2 text-sm text-ink-muted">
                    {a.merchant && `${a.merchant}: `}{a.messageKey ? tr(a.messageKey, a.messageParams) : a.message}
                  </div>
                ))}
              </>}
        </Tile>
        <Tile action={tr("overview.explore")} href={withModes("/installments", modes)} label={tr("overview.installments")}>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{fmtMoney(t.installmentTotal, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("overview.installments.detail", { months: t.installmentMonths })}</div>
        </Tile>
        <Tile action={tr("overview.explore")} href={withModes("/trends", modes)} label={tr("overview.trend", { value: valueLabel })}>
          <Sparkline data={t.sparkline} />
        </Tile>
      </div>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        {tr("overview.footer")}
      </p>
    </main>
  );
}
