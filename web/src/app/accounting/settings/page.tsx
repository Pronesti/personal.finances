import Link from "next/link";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { getT } from "@/lib/locale";
import { resolveLabel, type AccountGroup } from "@/lib/accounting/catalog";
import { AccountingCatalogForm } from "@/components/AccountingCatalogForm";
import { renameAccountAction, saveAccountGroupAction } from "./actions";

export default async function AccountingSettingsPage() {
  const t = await getT();
  if (selectedBackend() !== "postgres") return <p>{t("accounting.disabled")}</p>;
  const { accounts, groups } = await withAccounting(({ ledger }) => ledger.transaction(async tx => ({ accounts: await tx.catalogAccounts(), groups: await tx.catalogGroups() })));
  const inputClass = "w-full rounded border border-line bg-surface p-2";
  const groupForm = (group: AccountGroup | null) => <AccountingCatalogForm action={saveAccountGroupAction}>
    <input type="hidden" name="groupId" value={group?.id ?? ""} />
    <label className="block">{t("accounting.catalog.name")}<input name="customName" required maxLength={200} defaultValue={group ? resolveLabel(group, t.locale) : ""} className={inputClass} /></label>
    {group?.additive ? <p className="text-sm text-ink-muted">{t("accounting.catalog.primary")}</p> : <fieldset className="max-h-72 space-y-2 overflow-auto rounded border border-line p-3"><legend>{t("accounting.catalog.members")}</legend>{accounts.map(account => <label key={account.id} className="flex items-start gap-2"><input type="checkbox" name="accountId" value={account.id} defaultChecked={group?.accountIds.includes(account.id)} /><span>{resolveLabel(account, t.locale)} <span className="text-xs text-ink-muted">({account.id})</span></span></label>)}</fieldset>}
    <button className="rounded border border-line px-3 py-2 text-accent">{t("accounting.catalog.save")}</button>
  </AccountingCatalogForm>;
  return <div className="space-y-6">
    <Link href="/accounting" className="text-accent underline">{t("accounting.title")}</Link>
    
    <p>{t("accounting.catalog.literal")}</p>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{t("accounting.accounts")}</h2>{accounts.map(account => <details key={account.id} className="rounded border border-line p-3"><summary className="cursor-pointer">{resolveLabel(account, t.locale)} <span className="text-xs text-ink-muted">({account.id})</span></summary><div className="mt-3"><AccountingCatalogForm action={renameAccountAction}>
      <input type="hidden" name="accountId" value={account.id} /><label className="block">{t("accounting.catalog.name")}<input required name="customName" maxLength={200} defaultValue={account.customName ?? resolveLabel(account, t.locale)} className={inputClass} /></label>
      <button className="rounded border border-line px-3 py-2 text-accent">{t("accounting.catalog.save")}</button>
      {account.labelKey && <button name="restoreBuiltin" value="yes" className="ml-3 text-accent underline">{t("accounting.catalog.reset")}</button>}
    </AccountingCatalogForm></div></details>)}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{t("accounting.catalog.groups")}</h2><p className="text-sm text-ink-muted">{t("accounting.catalog.nonadditive")}</p>{groups.map(group => <details key={group.id} className="rounded border border-line p-3"><summary className="cursor-pointer">{resolveLabel(group, t.locale)}</summary><div className="mt-3">{groupForm(group)}</div></details>)}<details className="rounded border border-line p-3"><summary className="cursor-pointer">{t("accounting.catalog.create")}</summary><div className="mt-3">{groupForm(null)}</div></details></section>
  </div>;
}
