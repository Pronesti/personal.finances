import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { valueFacts } from "@/lib/receipts/value";
import { buildAnalytics } from "@/lib/receipts/analytics";
import { fmtMoneyCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { getT } from "@/lib/locale";
import { parseModes, valueOpts, type SP } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function SuperCategories({ searchParams }: { searchParams: Promise<SP> }) {
  const tr = await getT();
  const modes = parseModes(await searchParams);
  const { receipts, items } = valueFacts(loadFacts(getDb()), valueOpts(modes));
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const max = Math.max(1, ...a.categories.flatMap(c => c.perPeriod));
  const th = "py-1 text-ink-muted";
  return (
    <main>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={`${th} text-left`}>{tr("super.categories.category")}</th>
            {a.periods.map(p => <th key={p.index} className={`${th} text-right font-normal`}>{p.date.slice(5)}</th>)}
            <th className={`${th} text-right`}>{tr("super.categories.total")}</th>
            <th className={`${th} text-right`}>{tr("super.categories.share")}</th>
            <th className={`${th} text-right`}>{tr("super.categories.discounts")}</th>
          </tr></thead>
          <tbody>
            {a.categories.map(c => (
              <tr key={c.category} className="border-t border-line">
                <td className="py-1">{tr(`productCategory.${c.category}`)}</td>
                {c.perPeriod.map((v, i) => (
                  // One hue, light to dark: the accent at an opacity that follows the amount.
                  <td key={i} className="text-right font-mono tabular-nums" style={{ background: `color-mix(in srgb, var(--accent) ${Math.max(0, Math.round(v / max * 70))}%, transparent)` }}>
                    {v === 0 ? <span className="text-ink-subtle">—</span> : fmtMoneyCents(v, modes.value)}
                  </td>
                ))}
                <td className="text-right font-mono">{fmtMoneyCents(c.totalNetCents, modes.value)}</td>
                <td className="text-right">{fmtPct(c.sharePct).replace("+", "")}</td>
                <td className="text-right font-mono">{fmtMoneyCents(c.totalDiscountCents, modes.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.categories.footer")}</p>
    </main>
  );
}
