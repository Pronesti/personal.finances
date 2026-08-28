import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { installmentBurden, activePlans } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, spanLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { InstallmentBurdenChart } from "@/components/InstallmentBurdenChart";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Installments({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const burden = installmentBurden(db, opts, g);
  const plans = activePlans(db, opts);
  const latest = burden.at(-1);
  const committed = plans.reduce((s, p) => s + p.remainingTotal, 0);
  const tr = await getT();
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("installments.title")}</h1>
        {/* spend toggle hidden: this page is cash by definition — see installmentBurden */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/installments", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("installments.openPlans")}</div>
          <div className="text-2xl font-bold">{plans.length}</div>
          <div className="text-sm text-ink-muted">{tr("installments.openPlans.detail")}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("installments.stillToPay")}</div>
          <div className="text-2xl font-bold">{fmtMoney(committed, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("installments.stillToPay.detail")}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("installments.share")}</div>
          <div className="text-2xl font-bold">{latest ? pct(latest.sharePct) : "—"}</div>
          <div className="text-sm text-ink-muted">{tr("installments.share.detail", { span: spanLabel(g, tr.locale) })}</div>
        </div>
      </div>

      <InstallmentBurdenChart data={burden} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        {tr("installments.chartNote")}{" "}
        <Link href={withModes("/future", modes)} className="text-accent hover:underline">{tr("nav.future")}</Link>.
      </p>

      <h2 className="mb-3 text-lg font-semibold">{tr("installments.openPlans")}</h2>
      {plans.length === 0
        ? <p className="text-sm text-ink-muted">{tr("installments.none")}</p>
        : <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="py-1 pr-3">{tr("installments.table.merchant")}</th><th className="pr-3">{tr("installments.table.card")}</th>
                <th className="pr-3 text-right">{tr("installments.table.progress")}</th><th className="pr-3 text-right">{tr("installments.table.monthly")}</th>
                <th className="pr-3 text-right">{tr("installments.table.monthsLeft")}</th><th className="pr-3 text-right">{tr("installments.table.stillToPay")}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-3">
                    <Link href={withModes("/categories", modes, { merchant: p.merchant })} className="text-accent hover:underline">
                      {p.merchant}
                    </Link>
                  </td>
                  <td className="pr-3 text-ink-muted">{p.brand}</td>
                  <td className="pr-3 text-right">{p.paid}/{p.total}</td>
                  <td className="pr-3 text-right">{fmtMoney(p.monthly, modes.value)}</td>
                  <td className="pr-3 text-right">{p.remainingMonths}</td>
                  <td className="pr-3 text-right">{fmtMoney(p.remainingTotal, modes.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      {plans.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">{tr("installments.tableNote")}</p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("installments.footer")}</p>
    </main>
  );
}
