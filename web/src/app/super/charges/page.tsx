import Link from "next/link";
import { getDb } from "@/lib/db";
import { reconciliation, type ChargeRef } from "@/lib/receipts/charges";
import { fmtArsCents } from "@/lib/receipts/money";
import { fmtArs } from "@/lib/format";
import { Stat } from "@/components/Stat";
import { getT } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";
import { linkChargeAction, unlinkChargeAction } from "./actions";

export const dynamic = "force-dynamic";

const button = "rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90";
const quiet = "rounded-lg px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink";

function ChargeLine({ c, tr }: { c: ChargeRef; tr: Translator }) {
  return (
    <span>
      {c.brand} · {c.date} · {c.description} · <span className="font-mono">{fmtArsCents(c.purchaseCents)}</span>
      {c.installment_count && c.installment_count > 1 && (
        <span className="text-ink-muted"> ({tr("super.charges.installmentOf", { n: c.installment_number ?? 1, of: c.installment_count, each: fmtArs(c.ars) })})</span>
      )}
    </span>
  );
}

export default async function SuperCharges() {
  const tr = await getT();
  const r = reconciliation(getDb());
  if (r.receipts.length === 0 && r.charges.length === 0)
    return <main><p className="text-sm text-ink-muted">{tr("super.charges.empty")}</p></main>;
  const s = r.summary;
  const coverage = s.chargedCents === 0 ? 0 : s.matchedCents * 100 / s.chargedCents;
  const unlinkedReceipts = r.receipts.filter(x => x.state !== "matched");
  const th = "py-1 text-left text-ink-muted";
  return (
    <main className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={tr("super.charges.stat.charged")} value={fmtArsCents(s.chargedCents)} detail={tr("super.charges.stat.chargedDetail", { count: r.charges.length })} />
        <Stat label={tr("super.charges.stat.analyzed")} value={fmtArsCents(s.matchedCents)} detail={tr("super.charges.stat.analyzedDetail", { pct: `${coverage.toFixed(0)}%` })} />
        <Stat label={tr("super.charges.stat.open")} value={s.unmatchedCharges} tone={s.unmatchedCharges > 0 ? "text-warning" : undefined}
          detail={tr("super.charges.stat.openDetail", { count: s.unmatchedCharges, pending: s.pendingReceipts })} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.charges.receipts")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.charges.table.date")}</th><th className={`${th} text-right`}>{tr("super.charges.table.total")}</th>
            <th className={th}>{tr("super.charges.table.state")}</th><th className={th}>{tr("super.charges.table.charge")}</th>
          </tr></thead>
          <tbody>
            {r.receipts.map(x => (
              <tr key={x.id} className="border-t border-line align-top">
                <td className="py-1 whitespace-nowrap"><Link href={`/receipts/${x.id}`} className="text-accent underline">{x.date}</Link></td>
                <td className="text-right font-mono">{fmtArsCents(x.totalCents)}</td>
                <td className={x.state === "matched" ? "text-positive" : x.state === "pending" ? "text-warning" : "text-ink-muted"}>
                  {tr(`super.charges.state.${x.state}`)}{x.method && <span className="text-xs text-ink-muted"> · {tr(`super.charges.method.${x.method}`)}</span>}
                </td>
                <td>
                  {x.charge && (
                    <form action={unlinkChargeAction} className="flex flex-wrap items-center gap-2">
                      <ChargeLine c={x.charge} tr={tr} />
                      <input type="hidden" name="receipt" value={x.id} />
                      <button type="submit" className={quiet}>{tr("super.charges.unlink")}</button>
                    </form>
                  )}
                  {!x.charge && x.candidates.map(c => (
                    <form key={c.fingerprint} action={linkChargeAction} className="flex flex-wrap items-center gap-2">
                      <ChargeLine c={c} tr={tr} />
                      <input type="hidden" name="receipt" value={x.id} />
                      <input type="hidden" name="fingerprint" value={c.fingerprint} />
                      <button type="submit" className={button}>{tr("super.charges.link")}</button>
                    </form>
                  ))}
                  {!x.charge && x.candidates.length === 0 && <span className="text-ink-subtle">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.charges.charges")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.charges.table.date")}</th><th className={th}>{tr("super.charges.table.card")}</th>
            <th className={th}>{tr("super.charges.table.description")}</th>
            <th className={`${th} text-right`}>{tr("super.charges.table.amount")}</th>
            <th className={th}>{tr("super.charges.table.installments")}</th>
            <th className={th}>{tr("super.charges.table.receipt")}</th>
          </tr></thead>
          <tbody>
            {r.charges.map(c => (
              <tr key={c.fingerprint} className="border-t border-line align-top">
                <td className="py-1 whitespace-nowrap">{c.date}</td>
                <td>{c.brand}</td>
                <td>{c.description}</td>
                <td className="text-right font-mono">{fmtArsCents(c.purchaseCents)}</td>
                <td className="text-xs text-ink-muted">
                  {c.installment_count && c.installment_count > 1
                    ? tr("super.charges.installmentOf", { n: c.installment_number ?? 1, of: c.installment_count, each: fmtArs(c.ars) })
                    : "—"}
                </td>
                <td>
                  {c.receiptId !== null ? (
                    <Link href={`/receipts/${c.receiptId}`} className="text-accent underline">{c.receiptDate}</Link>
                  ) : unlinkedReceipts.length === 0 ? (
                    <span className="text-warning">{tr("super.charges.noReceipt")}</span>
                  ) : (
                    // The user knows which trip this was; offer every receipt that has no charge yet.
                    <form action={linkChargeAction} className="flex items-center gap-2">
                      <input type="hidden" name="fingerprint" value={c.fingerprint} />
                      <select name="receipt" className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-xs text-ink" aria-label={tr("super.charges.linkTo")}>
                        {unlinkedReceipts.map(x => <option key={x.id} value={x.id}>{x.date} · {fmtArsCents(x.totalCents)}</option>)}
                      </select>
                      <button type="submit" className={quiet}>{tr("super.charges.link")}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.charges.footer")}</p>
    </main>
  );
}
