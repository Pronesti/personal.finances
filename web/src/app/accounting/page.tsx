import Link from "next/link";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { getT } from "@/lib/locale";
import { resolveLabel } from "@/lib/accounting/catalog";
import { AccountingError, type Account, type Currency } from "@/lib/accounting/model";
import { groupMeasures } from "@/lib/accounting/group-measures";
import { fmtMoneyCents } from "@/lib/receipts/money";

export default async function AccountingPage() {
  const t = await getT();
  if (selectedBackend() !== "postgres") {
    return <p className="rounded-xl border border-line p-6 text-ink-muted">{t("accounting.disabled")}</p>;
  }
  const inspection = await withAccounting(({ reader }) => reader.inspection());
  const accounts = new Map(inspection.accounts.map(account => [account.id, account]));
  const balances = new Map<string, { account: Account; currency: Currency; minor: number }>();
  for (const journal of inspection.journals) {
    for (const line of journal.lines) {
      const account = accounts.get(line.accountId);
      if (!account) throw new AccountingError("missing_account", { accountId: line.accountId });
      const key = `${account.id}\0${journal.currency}`;
      const current = balances.get(key)?.minor ?? 0;
      const direction = ["asset", "expense"].includes(account.type) ? 1 : -1;
      const minor = current + direction * (line.debitMinor - line.creditMinor);
      if (!Number.isSafeInteger(minor)) throw new AccountingError("invalid_minor_units");
      balances.set(key, { account, currency: journal.currency, minor });
    }
  }
  const amount = (minor: number, currency: Currency) => fmtMoneyCents(minor, currency === "USD" ? "usd" : "nominal");
  return <div className="space-y-8">
    <section>
      
      <Link href="/accounting/settings" className="text-accent underline">{t("accounting.catalog.title")}</Link>
      <p className="mt-2 text-sm text-ink-muted">{t("accounting.subtitle")}</p>
      <p className="mt-2 text-sm text-ink-muted">{t("accounting.native")}</p>
    </section>
    {inspection.openingCoverage?.mode === "opening" && <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">{t("accounting.coverage.title")}</h2>
      <p className="text-sm text-ink-muted">{t("accounting.coverage.explanation")}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-sm"><thead><tr><th className="p-2">{t("accounting.card")}</th><th>{t("accounting.coverage.date")}</th><th>{t("accounting.currency")}</th><th>{t("accounting.account.billed")}</th><th>{t("accounting.coverage.supported")}</th><th>{t("accounting.coverage.unproven")}</th></tr></thead><tbody>{inspection.openingCoverage.reconciliation.map(row=><tr key={`${row.cardId}:${row.currency}`} className="border-t border-line"><td className="p-2">{inspection.cards.find(card=>card.id===row.cardId)?.displayName??row.cardId}</td><td>{row.issuerDate}</td><td>{row.currency}</td><td>{row.issuerBilledMinor===null?"—":amount(row.issuerBilledMinor,row.currency)}</td><td>{row.supportedUnbilledMinor===undefined?"—":amount(row.supportedUnbilledMinor,row.currency)}</td><td>{row.unsupportedFutureRemainderMinor===undefined?"—":amount(row.unsupportedFutureRemainderMinor,row.currency)}</td></tr>)}</tbody></table></div>
    </section>}
    <section id="groups" className="space-y-3">
      <h2 className="text-lg font-semibold">{t("accounting.catalog.groups")}</h2>
      <p className="text-sm text-ink-muted">{t("accounting.catalog.nonadditive")} {t("accounting.catalog.measureScope")}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{t("accounting.catalog.name")}</th><th>{t("accounting.currency")}</th><th>{t("accounting.reports.expense")}</th><th>{t("accounting.reports.debt")}</th><th>{t("accounting.reports.repayment")}</th></tr></thead><tbody>{(inspection.groups??[]).filter(group=>!group.additive).flatMap(group=>(["ARS","USD"] as const).map(currency=>{
        const values=groupMeasures({group,accounts:inspection.accounts,journals:inspection.journals,currency,from:"0001-01-01",to:"9999-12-31"});
        return <tr key={`${group.id}:${currency}`} className="border-t border-line"><td className="p-2">{resolveLabel(group,t.locale)}</td><td>{currency}</td><td>{amount(values.expenseMinor,currency)}</td><td>{amount(values.debtMinor,currency)}</td><td>{amount(values.repaymentMinor,currency)}</td></tr>;
      }))}</tbody></table></div>
      <Link href="/accounting/settings" className="text-accent underline">{t("accounting.catalog.create")}</Link>
    </section>
    {inspection.journals.length === 0 ? <p role="status">{t("accounting.empty")}</p> : <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("accounting.accounts")}</h2>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-line bg-surface">
              <th className="p-3">{t("accounting.account")}</th><th className="p-3">{t("accounting.currency")}</th><th className="p-3 text-right">{t("accounting.balance")}</th>
            </tr></thead>
            <tbody>{[...balances.entries()].map(([key, row]) => <tr key={key} className="border-b border-line last:border-0">
              <td className="p-3">{resolveLabel(row.account, t.locale)}</td><td className="p-3">{row.currency}</td>
              <td className="p-3 text-right tabular-nums">{amount(row.minor, row.currency)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">{t("accounting.clearingNote")}</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("accounting.journals")}</h2>
        <p className="text-sm text-ink-muted">{t("accounting.audit")}</p>
        {inspection.journals.map(journal => <article key={journal.id} id={`entry-${journal.id}`} className="rounded-xl border border-line p-4">
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-ink-muted">{t("accounting.event")}</dt><dd>{t(`accounting.kind.${journal.kind}`)}</dd></div>
            <div><dt className="text-ink-muted">{t("accounting.card")}</dt><dd>{inspection.cards.find(card => card.id === journal.cardId)?.displayName ?? journal.cardId}</dd></div>
            <div><dt className="text-ink-muted">{t("accounting.effectiveDate")}</dt><dd>{journal.effectiveDate}</dd></div>
            <div><dt className="text-ink-muted">{t("accounting.recordedAt")}</dt><dd>{journal.recordedAt}</dd></div>
          </dl>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr><th className="py-2">{t("accounting.account")}</th><th className="py-2 text-right">{t("accounting.debit")}</th><th className="py-2 text-right">{t("accounting.credit")}</th></tr></thead>
            <tbody>{journal.lines.map((line, i) => <tr key={i} className="border-t border-line">
              <td className="py-2">{resolveLabel(accounts.get(line.accountId)!, t.locale)}</td>
              <td className="py-2 text-right tabular-nums">{line.debitMinor ? amount(line.debitMinor, journal.currency) : "—"}</td>
              <td className="py-2 text-right tabular-nums">{line.creditMinor ? amount(line.creditMinor, journal.currency) : "—"}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">{journal.evidenceIds.map((id, index) => <Link key={id} className="underline underline-offset-4" href={`/accounting/evidence/${encodeURIComponent(id)}`}>{t("accounting.evidence")} {index + 1}</Link>)}</div>
        </article>)}
      </section>
    </>}
  </div>;
}
