import { ProductEditForm } from "@/components/ProductEditForm";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { accountingProductReview } from "@/lib/accounting/receipt-ui";
import { postgresPageGate } from "@/components/accounting-gate";
import { getDb } from "@/lib/db";
import { reviewQueue, allProducts } from "@/lib/receipts/products";
import { PRODUCT_CATEGORIES } from "@/lib/receipts/categories";
import { fmtArsCents } from "@/lib/receipts/money";
import { getT } from "@/lib/locale";
import { saveProductAction, mergeProductAction, rematchAllAction, moveCodeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SuperReview() {
  const accountingGate = await postgresPageGate("/super/review");
  if (accountingGate) return accountingGate;

  const tr = await getT();
  const pg=selectedBackend()==="postgres" ? await withAccounting(({ledger})=>accountingProductReview(ledger)) : null;
  const queue = pg ? pg.queue : reviewQueue(getDb());
  const options = pg ? pg.options : allProducts(getDb());
  const field = "mt-0.5 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink";
  const button = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90";
  const pendingCount = pg ? pg.queue.filter(p=>!p.reviewed).length : queue.length;
  return (
    <main>
      <p className="mb-4 text-sm text-ink-muted">
        {pendingCount === 0 ? (pg?receiptText(tr.locale,"accounting.receipts.canonicalQueueEmpty"):tr("super.review.none")) : tr("super.review.summary", { count: pendingCount })}
      </p>
      <form action={rematchAllAction} className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <button type="submit" className={button}>{tr("super.review.rematch")}</button>
        <p className="text-xs text-ink-muted">{tr("super.review.rematchNote")}</p>
      </form>
      {pg&&<h2 className="mb-4 font-semibold">{receiptText(tr.locale,"accounting.receipts.productCatalog")}</h2>}
      <div className="space-y-4">
        {queue.map(p => (
          <div key={p.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-ink-muted">{tr("super.review.lines", { count: p.timesBought, total: fmtArsCents(p.totalSpentCents) })}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 text-xs text-ink-muted">
              <dt>{tr("super.review.seen")}</dt><dd className="font-mono">{p.descriptions.join(" · ")}</dd>
              <dt>{tr("super.review.codes")}</dt><dd className="font-mono">{p.codes.join(" · ") || "—"}</dd>
            </dl>
            <ProductEditForm action={saveProductAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_6rem_auto] sm:items-end">
              <input type="hidden" name="id" value={p.id} />
              <label className="text-xs text-ink-muted">{tr("super.review.name")}
                <input name="name" defaultValue={p.name} required className={field} />
              </label>
              <label className="text-xs text-ink-muted">{tr("super.review.category")}
                <select name="category" defaultValue={p.category} className={field}>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{tr(`productCategory.${c}`)}</option>)}
                </select>
              </label>
              <label className="text-xs text-ink-muted">{tr("super.review.unit")}
                <select name="unit" defaultValue={p.unit} className={field}>
                  <option value="un">{tr("super.unit.un")}</option>
                  <option value="kg">{tr("super.unit.kg")}</option>
                </select>
              </label>
              <button type="submit" className={button}>{tr("super.review.save")}</button>
            </ProductEditForm>
            <form action={mergeProductAction} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="source" value={p.id} />
              <label className="min-w-64 text-xs text-ink-muted">{tr("super.review.mergeInto")}
                <select name="target" className={field}>
                  {options.filter(o => o.id !== p.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
                {tr("super.review.merge")}
              </button>
            </form>
            {pg&&p.codes.map(sku=><form key={sku} action={moveCodeAction} className="mt-3 flex flex-wrap items-end gap-3"><input type="hidden" name="sku" value={sku}/><label className="text-xs text-ink-muted">{receiptText(tr.locale,"accounting.receipts.moveCode")} · <span className="font-mono">{sku}</span><select name="target" required className={field} defaultValue=""><option value="">—</option>{options.filter(o=>o.id!==p.id).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button className={button}>{receiptText(tr.locale,"accounting.receipts.moveCode")}</button></form>)}
          </div>
        ))}
      </div>
      {selectedBackend()==="postgres"&&<p className="mt-6 text-xs text-ink-muted">{receiptText(tr.locale,"accounting.receipts.pendingProducts")}</p>}
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.review.footer")}</p>
    </main>
  );
}
