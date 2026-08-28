import Link from "next/link";
import { getDb } from "@/lib/db";
import { unknownMerchants, rulePreview, merchantEvidence } from "@/lib/queries";
import { loadCategoryFile, pendingMerchants, CATEGORIES } from "@/lib/categorize";
import { fmtArs } from "@/lib/format";
import { ProposeButton } from "@/components/ProposeButton";
import { getT } from "@/lib/locale";
import { acceptAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function Review() {
  const db = getDb();
  const data = loadCategoryFile();
  const unknown = unknownMerchants(db);
  const spend = new Map(unknown.map(u => [u.merchant, u.total]));
  const pending = pendingMerchants(data, unknown.map(u => u.merchant));
  const previews = new Map(data.proposals.map(p => [p.merchant, rulePreview(db, p.merchant)]));
  const tr = await getT();
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">{tr("review.title")}</h1>
      <p className="mb-4 text-sm text-ink-muted">
        {tr("review.summary.rules", { count: data.rules.length })} ·{" "}
        {tr("review.summary.awaiting", { count: data.proposals.length })} ·{" "}
        <Link className="text-accent hover:underline" href="/categories?category=other">
          {tr("review.summary.uncategorized", { count: unknown.length })}
        </Link>. {tr("review.summary.privacy")}
      </p>
      <ProposeButton pending={pending.length} />

      {data.proposals.length > 0 && (
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">{tr("review.table.merchant")}</th><th>{tr("review.table.rule")}</th>
            <th className="text-right">{tr("review.table.spend")}</th><th className="text-right">{tr("review.table.decide")}</th>
          </tr></thead>
          <tbody>
            {data.proposals.map((p, i) => {
              const also = (previews.get(p.merchant) ?? []).filter(r => r.merchant !== p.merchant);
              const ev = merchantEvidence(db, p.merchant);
              return (
                <tr key={p.merchant} className="border-t border-line align-top">
                  <td className="py-1 pr-3">
                    {p.merchant}
                    {p.confidence === "low" && <span className="ml-2 text-xs text-warning">{tr("review.lowConfidence")}</span>}
                    {p.sent !== p.merchant && <div className="text-xs text-ink-muted">{tr("review.sentAs", { name: p.sent })}</div>}
                    {ev && (
                      <div className="text-xs text-ink-muted">
                        {tr.plural("review.charges", ev.count)} ·{" "}
                        {ev.firstMonth === ev.lastMonth ? ev.firstMonth : `${ev.firstMonth} – ${ev.lastMonth}`} ·{" "}
                        {ev.brands.join(", ")}
                      </div>
                    )}
                    {ev && ev.sample.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-accent hover:underline">
                          {tr("review.statementLines")}
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
                                      {tr("review.installment", {
                                        number: s.installment_number ?? 0,
                                        count: s.installment_count,
                                      })}
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
                          <div className="mt-0.5 text-ink-muted">{tr("review.andMore", { count: ev.count - ev.sample.length })}</div>
                        )}
                      </details>
                    )}
                  </td>
                  <td>
                    <form action={acceptAction} className="flex flex-wrap items-center gap-2" id={`f-${i}`}>
                      <input type="hidden" name="merchant" value={p.merchant} />
                      <input name="match" defaultValue={p.merchant} className="w-48 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink" />
                      <select name="category" defaultValue={p.category} className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink">
                        {CATEGORIES.map(c => <option key={c} value={c}>{tr(`category.${c}`)}</option>)}
                      </select>
                      <input name="subcategory" defaultValue={p.subcategory} className="w-32 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink" />
                    </form>
                    {also.length > 0 && (
                      <div className="mt-1 text-xs text-warning">
                        {tr("review.alsoClaims", { merchants: also.map(r => `${r.merchant} (${r.count}×)`).join(", ") })}
                      </div>
                    )}
                  </td>
                  {/* A USD-only merchant nets 0 ARS; "$ 0" would read as "this cost nothing". */}
                  <td className="text-right">{spend.get(p.merchant) ? fmtArs(spend.get(p.merchant)!) : "—"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button form={`f-${i}`} type="submit" className="text-accent hover:underline">{tr("review.accept")}</button>
                    <span className="px-1">·</span>
                    <form action={rejectAction} className="inline">
                      <input type="hidden" name="merchant" value={p.merchant} />
                      <button type="submit" className="text-ink-muted hover:text-negative hover:underline">{tr("review.reject")}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs text-ink-muted">{tr("review.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("review.footer")}</p>
    </main>
  );
}
