"use client";
import {useActionState,useState} from "react";
import {accountingSourceClassifyAction} from "@/app/categories/actions";
import {useT} from "./I18nProvider";
export function AccountingSourceCorrectionForm({commandKey,sourceLineId,accountId,merchant,accounts,affected}:{commandKey:string;sourceLineId:string;accountId:string|null;merchant:string;accounts:{id:string;label:string}[];affected:{id:string;merchant:string}[]}){
 const t=useT(),[scope,setScope]=useState("selected"),[state,action,pending]=useActionState(accountingSourceClassifyAction,null);
 return <details className="text-left"><summary className="cursor-pointer text-accent">{t("accounting.reports.correctSource")}</summary><form action={action} onReset={event=>event.preventDefault()} className="mt-2 space-y-3 rounded-lg border border-line p-3">
  <input type="hidden" name="key" value={commandKey}/><input type="hidden" name="sourceLineId" value={sourceLineId}/><input type="hidden" name="match" value={merchant}/><input type="hidden" name="confirmedSourceLineIds" value={JSON.stringify(affected.map(a=>a.id))}/>
  <label className="block">{t("accounting.reports.account")}<select name="accountId" defaultValue={accountId??"expense:unallocated"} className="mt-1 block max-w-full rounded border border-line bg-surface p-2">{accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
  <label className="block">{t("accounting.reports.scope")}<select name="scope" value={scope} onChange={e=>setScope(e.target.value)} className="mt-1 block max-w-full rounded border border-line bg-surface p-2"><option value="selected">{t("accounting.reports.selected")}</option>{merchant.length>=3&&<><option value="future_rule">{t("accounting.reports.future")}</option><option value="matching_history">{t("accounting.reports.history")}</option></>}</select></label>
  {scope!=="selected"&&<p className="text-xs text-ink-muted">{t("accounting.reports.ruleMatch")}: {merchant}</p>}
  {scope==="matching_history"&&<div><p>{t("accounting.reports.confirm")}</p><ul className="max-h-40 overflow-auto text-xs">{affected.map(a=><li key={a.id}>{a.merchant} · {a.id}</li>)}</ul><label className="mt-2 flex items-start gap-2"><input key={affected.map(a=>a.id).sort().join("|")} type="checkbox" name="confirmHistory" value="yes" required/>{t("accounting.reports.confirm")}</label></div>}
  <button disabled={pending} className="rounded border border-line px-3 py-2 text-accent disabled:opacity-50">{t("accounting.reports.save")}</button>{state&&<p role="status" className={state.ok?"text-ink-muted":"text-warning"}>{state.messageKey?t(state.messageKey):state.message}</p>}
 </form></details>;
}
