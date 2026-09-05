import { toMode, type ValueOpts } from "@/lib/queries";
import { latestMonth } from "@/lib/cpi";
import type { ReceiptFact, ItemFact } from "./facts";

export type Facts = { receipts: ReceiptFact[]; items: ItemFact[] };

/**
 * Cents printed at the receipt's month, restated in the page's value basis: pesos of the latest
 * CPI month (real), the printed pesos (nominal), or USD cents at that month's MEP. Rounded back
 * to integer cents so the analytics keep summing integers. `toMode` is the card pages' one home
 * of real/usd semantics, so a receipt and a charge from the same month restate identically — and
 * a month past the tables reads at the latest one, i.e. unchanged until the index is published.
 */
export function valueCents(cents: number, month: string, opts: ValueOpts, baseMonth: string): number {
  return Math.round(toMode(cents, month, opts, baseMonth));
}

/** Every money field of the facts converted by its receipt's month; quantities, dates and tags untouched. */
export function valueFacts(facts: Facts, opts: ValueOpts): Facts {
  if (opts.value === "nominal") return facts;
  const baseMonth = opts.value === "real" ? latestMonth(opts.cpi) : "";
  const monthOf = new Map(facts.receipts.map(r => [r.id, r.date.slice(0, 7)]));
  const conv = (cents: number, month: string) => valueCents(cents, month, opts, baseMonth);
  return {
    receipts: facts.receipts.map(r => {
      const m = r.date.slice(0, 7);
      return { ...r, subtotalCents: conv(r.subtotalCents, m), discountsCents: conv(r.discountsCents, m), totalCents: conv(r.totalCents, m) };
    }),
    items: facts.items.map(i => {
      const m = monthOf.get(i.receiptId);
      return m ? { ...i, grossCents: conv(i.grossCents, m), discountCents: conv(i.discountCents, m) } : i;
    }),
  };
}
