import { TableScroll } from "@/components/TableScroll";
import { PageGuide } from "@/components/PageGuide";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { installmentBurden, activePlans } from "@/lib/queries";
import { parseModes, parseGranularity, spanLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney } from "@/lib/format";
import { Stat, StatRail } from "@/components/Stat";
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
      <div className="mb-6">
        <PageGuide summary={tr("installments.purpose")} detail={tr("installments.footer")} />
      </div>
      <StatRail stats={
        <>
          <Stat
            label={tr("installments.openPlans")}
            value={plans.length}
            detail={tr("installments.openPlans.detail")}
          />
          <Stat
            label={tr("installments.stillToPay")}
            value={fmtMoney(committed, modes.value)}
            detail={tr("installments.stillToPay.detail")}
          />
          <Stat
            label={tr("installments.share")}
            value={latest ? pct(latest.sharePct) : "—"}
            detail={tr("installments.share.detail", { span: spanLabel(g, tr.locale) })}
          />
        </>
      }>
        <InstallmentBurdenChart data={burden} value={modes.value} />
        <p className="mb-8 mt-3 max-w-[80ch] text-xs text-ink-muted">
          {tr("installments.chartNote")}{" "}
          <Link href={withModes("/future", modes)} className="text-accent hover:underline">{tr("nav.future")}</Link>.
        </p>

        <h2 className="mb-3 text-lg font-semibold">{tr("installments.openPlans")}</h2>
        {plans.length === 0
          ? <p className="text-sm text-ink-muted">{tr("installments.none")}</p>
          : <TableScroll label={tr("installments.openPlans")}><table className="w-full min-w-[42rem] text-sm">
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
            </table></TableScroll>}
        {plans.length > 0 && (
          <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("installments.tableNote")}</p>
        )}
      </StatRail>
    </main>
  );
}
