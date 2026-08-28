import Link from "next/link";
import { getDb } from "@/lib/db";
import { unknownMerchants, rulePreview, merchantEvidence } from "@/lib/queries";
import { loadCategoryFile, pendingMerchants, CATEGORIES } from "@/lib/categorize";
import { fmtArs } from "@/lib/format";
import { ProposeButton } from "@/components/ProposeButton";
import { acceptAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function Review() {
  const db = getDb();
  const data = loadCategoryFile();
  const unknown = unknownMerchants(db);
  const spend = new Map(unknown.map(u => [u.merchant, u.total]));
  const pending = pendingMerchants(data, unknown.map(u => u.merchant));
  const previews = new Map(data.proposals.map(p => [p.merchant, rulePreview(db, p.merchant)]));
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">Review</h1>
      <p className="mb-4 text-sm text-ink-muted">
        {data.rules.length} rules · {data.proposals.length} awaiting review ·{" "}
        <Link className="text-accent hover:underline" href="/categories?category=other">
          {unknown.length} merchants still uncategorized
        </Link>. Only the merchant name is ever sent — never an amount, a date, an account number or
        your name, and any name that still looks like money is not sent at all.
      </p>
      <ProposeButton pending={pending.length} />

      {data.proposals.length > 0 && (
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">Merchant</th><th>Rule</th>
            <th className="text-right">Spend</th><th className="text-right">Decide</th>
          </tr></thead>
          <tbody>
            {data.proposals.map((p, i) => {
              const also = (previews.get(p.merchant) ?? []).filter(r => r.merchant !== p.merchant);
              const ev = merchantEvidence(db, p.merchant);
              return (
                <tr key={p.merchant} className="border-t border-line align-top">
                  <td className="py-1 pr-3">
                    {p.merchant}
                    {p.confidence === "low" && <span className="ml-2 text-xs text-warning">low confidence</span>}
                    {p.sent !== p.merchant && <div className="text-xs text-ink-muted">sent as &ldquo;{p.sent}&rdquo;</div>}
                    {ev && (
                      <div className="text-xs text-ink-muted">
                        {ev.count} {ev.count === 1 ? "charge" : "charges"} ·{" "}
                        {ev.firstMonth === ev.lastMonth ? ev.firstMonth : `${ev.firstMonth} – ${ev.lastMonth}`} ·{" "}
                        {ev.brands.join(", ")}
                      </div>
                    )}
                    {ev && ev.sample.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-accent hover:underline">
                          statement lines
                        </summary>
                        <table className="mt-1">
                          <tbody>
                            {ev.sample.map((s, j) => (
                              <tr key={j} className="text-ink-muted">
                                <td className="pr-3 whitespace-nowrap align-top">{s.date ?? "—"}</td>
                                <td className="pr-3 align-top">
                                  {s.description}
                                  {s.installment_count != null && (
                                    <span className="ml-1">
                                      (cuota {s.installment_number}/{s.installment_count})
                                    </span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap text-right align-top">
                                  {s.ars != null ? fmtArs(s.ars) : s.usd != null ? `US$ ${s.usd.toFixed(2)}` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {ev.count > ev.sample.length && (
                          <div className="mt-0.5 text-ink-muted">…and {ev.count - ev.sample.length} more</div>
                        )}
                      </details>
                    )}
                  </td>
                  <td>
                    <form action={acceptAction} className="flex flex-wrap items-center gap-2" id={`f-${i}`}>
                      <input type="hidden" name="merchant" value={p.merchant} />
                      <input name="match" defaultValue={p.merchant} className="w-48 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink" />
                      <select name="category" defaultValue={p.category} className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input name="subcategory" defaultValue={p.subcategory} className="w-32 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink" />
                    </form>
                    {also.length > 0 && (
                      <div className="mt-1 text-xs text-warning">
                        This rule also claims: {also.map(r => `${r.merchant} (${r.count}×)`).join(", ")}
                      </div>
                    )}
                  </td>
                  {/* A USD-only merchant nets 0 ARS; "$ 0" would read as "this cost nothing". */}
                  <td className="text-right">{spend.get(p.merchant) ? fmtArs(spend.get(p.merchant)!) : "—"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button form={`f-${i}`} type="submit" className="text-accent hover:underline">accept</button>
                    <span className="px-1">·</span>
                    <form action={rejectAction} className="inline">
                      <input type="hidden" name="merchant" value={p.merchant} />
                      <button type="submit" className="text-ink-muted hover:text-negative hover:underline">reject</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs text-ink-muted">
        Accepting appends a rule to data/merchant-categories.json and applies it to the transactions
        already loaded. Rules match by substring and are first-match-wins, so edit the rule text if it
        would claim merchants you did not mean — the warning above the accept button lists them.
        Accepted rules go last, so a rule you wrote by hand always beats one the model proposed.
        Rejecting remembers the merchant so it is not sent again.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page controls how merchants get their categories. The model proposes a rule for
        each merchant that has no category. Only the merchant name goes to the model. Examine
        each proposal and its statement lines. Accept a correct rule. Correct the category
        first when it is necessary. Reject a bad rule. The warning under a rule shows other
        merchants that the rule also captures. Examine that list before you accept the rule.
        Good categories make all the other pages exact. Many merchants without a category make
        the category pages less exact.
      </p>
    </main>
  );
}
