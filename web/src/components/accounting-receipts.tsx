import { AccountingActionForm } from "@/components/accounting-action-form";
import type { Account } from "@/lib/accounting/model";
import type { ReceiptFact } from "@/lib/accounting/read-model";
import type { receiptAccountMatrix } from "@/lib/accounting/receipt-account-matrix";
import { fmtMoneyCents, fmtArsCents } from "@/lib/receipts/money";
import Link from "next/link";
import type { accountingReceiptDetail } from "@/lib/accounting/receipt-ui";
import { sourceLineId } from "@/lib/accounting/evidence";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { resolveLabel } from "@/lib/accounting/catalog";
import { allocateReceiptItemsAction, recordReceiptPurchaseAction, reviewReceiptProductAction } from "@/app/receipts/accounting-actions";
type Detail=NonNullable<Awaited<ReturnType<typeof accountingReceiptDetail>>>;
const field="min-h-11 min-w-0 max-w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
export function AccountingReceiptControls({data,cards,locale}:{data:Detail;cards:{id:string;displayName:string}[];locale:"en"|"es"}){
  const text=(key:Parameters<typeof receiptText>[1])=>receiptText(locale,key),receiptRevisionId=data.facts.revisionId;
  const accounts=data.accounts.filter(a=>a.posting&&a.enabled&&(a.type==="expense" || a.type==="asset"&&!a.id.startsWith("clearing:"))&&!data.accounts.some(c=>c.parentId===a.id));
  return <section className="space-y-5 rounded-xl border border-line bg-surface p-4">
    <div className="min-w-0 max-w-full flex flex-wrap gap-4"><Link href={`/accounting/evidence/${encodeURIComponent(receiptRevisionId)}`} className="text-accent underline">{text("accounting.receipts.source")}</Link><a className="text-accent underline" href={`/api/accounting/documents/${data.revision.documentHash}`}>{text("accounting.receipts.originalPdf")}</a></div>
    {data.reviews.length>0&&<p role="status" className="text-sm text-warning">{text("accounting.receipts.pending")}</p>}
    {data.purchase && <div className="space-y-1 text-sm"><p>{text("accounting.receipts.purchaseRecorded")} · {cards.find(c=>c.id===data.purchase!.cardId)?.displayName??data.purchase.cardId} · {fmtArsCents(data.purchase.principalMinor)}</p><ul>{data.purchase.allocations.map((a,i)=>{const account=data.accounts.find(account=>account.id===a.accountId);return <li key={i}>{account?resolveLabel(account,locale):a.accountId} · {fmtArsCents(a.minor)}</li>;})}</ul></div>}
    <AccountingActionForm action={recordReceiptPurchaseAction} locale={locale} className="min-w-0 max-w-full flex flex-wrap items-center gap-3">
      <input type="hidden" name="receiptRevisionId" value={receiptRevisionId}/>
      <label className="min-w-0 max-w-full">{text("accounting.receipts.card")} <select name="cardId" required defaultValue="" className={field}><option value="">{text("accounting.receipts.chooseCard")}</option>{cards.map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
      <label className="min-w-0 max-w-full sm:max-w-lg flex items-center gap-2 text-sm"><input type="checkbox" name="paymentVerified" required/>{text("accounting.receipts.proof")}</label>
      <button className={field}>{text("accounting.receipts.post")}</button>
    </AccountingActionForm>
    <p className="text-sm text-ink-muted">{text("accounting.receipts.productApproval")}</p>
    <div className="space-y-2">{data.facts.parsed.items.map((item,i)=>{
      const id=sourceLineId(receiptRevisionId,i+1),match=data.matches.find(m=>m.id===id),product=data.products.find(p=>p.id===match?.productId);
      return <AccountingActionForm key={id} action={reviewReceiptProductAction} locale={locale} className="min-w-0 max-w-full flex flex-wrap items-center gap-3 text-sm"><input type="hidden" name="receiptRevisionId" value={receiptRevisionId}/><input type="hidden" name="sourceLineId" value={id}/><span className="min-w-0 break-words">{item.position}. {item.descPrinted}</span><select name="productId" aria-label={`${text("accounting.receipts.canonicalProduct")} ${item.position}`} required defaultValue={product?.reviewed?product.id:""} className={field}><option value="">{text("accounting.receipts.unitUnreviewed")}</option>{data.products.filter(p=>p.reviewed&&!p.redirectId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button className={field}>{text("accounting.receipts.approveItem")}</button></AccountingActionForm>;
    })}</div>
    <Link href="/super/review" className="block text-sm text-accent underline">{text("accounting.receipts.canonicalProducts")}</Link>
    <AccountingActionForm action={allocateReceiptItemsAction} locale={locale} className="min-w-0 max-w-full space-y-3"><input type="hidden" name="receiptRevisionId" value={receiptRevisionId}/>
      {data.facts.parsed.items.map((item,i)=>{const id=sourceLineId(receiptRevisionId,i+1),approved=data.matches.find(m=>m.id===id)?.reviewed;return <label key={id} className="min-w-0 max-w-full flex flex-wrap items-center gap-3 text-sm"><span className="min-w-0 break-words">{item.position}. {item.descPrinted}</span><select name={`account:${Buffer.from(id).toString("base64url")}`} disabled={!approved} defaultValue={data.link?.itemAllocations.find(a=>a.sourceLineId===id)?.accountId??""} className={field}><option value="">{text("accounting.receipts.unallocatedLabel")}</option>{accounts.map(a=><option key={a.id} value={a.id}>{resolveLabel(a,locale)}</option>)}</select></label>;})}
      <p className="text-xs text-ink-muted">{text("accounting.receipts.unallocated")}</p><button className={field}>{text("accounting.receipts.allocate")}</button>
    </AccountingActionForm>
  </section>;
}

export function ReceiptAccountMatrix({rows,receipts,accounts,locale,value}:{rows:ReturnType<typeof receiptAccountMatrix>;receipts:ReceiptFact[];accounts:Account[];locale:"en"|"es";value:"nominal"|"real"|"usd"}) {
 return <section className="mb-8 space-y-3"><h2 className="text-sm font-semibold">{receiptText(locale,"accounting.receipts.accountMatrix")}</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">{receiptText(locale,"accounting.receipts.account")}</th>{receipts.map(r=><th key={r.id} className="text-right font-normal">{r.date}</th>)}</tr></thead><tbody>{rows.map(row=>{const account=accounts.find(a=>a.id===row.accountId);return <tr key={row.accountId} className="border-t border-line"><th className="text-left font-normal">{account?resolveLabel(account,locale):row.accountId}{!row.reviewed&&<span className="ml-2 text-warning">{receiptText(locale,"accounting.receipts.unitUnreviewed")}</span>}</th>{receipts.map(r=><td key={r.id} className="text-right font-mono">{fmtMoneyCents(row.byReceipt[r.id]??0,value)}</td>)}</tr>;})}</tbody></table></div></section>;
}
