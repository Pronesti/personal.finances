import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { buildAnalytics, type ProductStat } from "@/lib/receipts/analytics";
import { fmtArsCents, fmtCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { TrendSparkline } from "@/components/TrendSparkline";
import { getT } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const qty = (milli: number, unit: "un" | "kg") =>
  unit === "kg" ? `${(milli / 1000).toFixed(3).replace(".", ",")} kg` : `${milli / 1000}`;
const tone = (p: number) => (p > 0.05 ? "text-negative" : p < -0.05 ? "text-positive" : "text-ink-muted");

function Habit({ title, products, tr }: { title: string; products: ProductStat[]; tr: Translator }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{title}</h3>
      <ul className="mt-1 text-sm">
        {products.length === 0 && <li className="text-ink-muted">{tr("super.products.nothing")}</li>}
        {products.map(p => <li key={p.productId}>{p.name} <span className="text-ink-muted">· {p.timesBought}</span></li>)}
      </ul>
    </div>
  );
}

export default async function SuperProducts() {
  const tr = await getT();
  const { receipts, items } = loadFacts(getDb());
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const repeated = a.products.filter(p => p.lastChange !== null)
    .sort((x, y) => Math.abs(y.lastChange!.grossPct) - Math.abs(x.lastChange!.grossPct));
  const th = "py-1 text-left text-ink-muted";
  return (
    <main className="space-y-10">
      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.changes")}</h2>
        {repeated.length === 0 ? <p className="text-sm text-ink-muted">{tr("super.products.noRepeats")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line">
                <th className={th}>{tr("super.products.product")}</th><th className={th}>{tr("super.products.category")}</th>
                <th className={`${th} text-right`}>{tr("super.products.times")}</th>
                <th className={`${th} text-right`}>{tr("super.products.lastGross")}</th>
                <th className={`${th} text-right`}>{tr("super.products.lastNet")}</th>
                <th className={th}>{tr("super.products.trend")}</th>
              </tr></thead>
              <tbody>
                {repeated.map(p => {
                  const c = p.lastChange!;
                  const from = p.appearances.find(x => x.index === c.from)!, to = p.appearances.find(x => x.index === c.to)!;
                  return (
                    <tr key={p.productId} className="border-t border-line align-top">
                      <td className="py-1">{p.name}<div className="text-xs text-ink-muted">{tr("super.products.between", { from: from.date, to: to.date })}</div></td>
                      <td>{tr(`productCategory.${p.category}`)}</td>
                      <td className="text-right">{p.timesBought}</td>
                      <td className={`text-right font-mono ${tone(c.grossPct)}`}>{fmtPct(c.grossPct)}<div className="text-xs text-ink-muted">{fmtCents(Math.round(from.unitGross))} → {fmtCents(Math.round(to.unitGross))}</div></td>
                      <td className={`text-right font-mono ${tone(c.netPct)}`}>{fmtPct(c.netPct)}<div className="text-xs text-ink-muted">{fmtCents(Math.round(from.unitNet))} → {fmtCents(Math.round(to.unitNet))}</div></td>
                      <td><TrendSparkline data={p.appearances.map(x => ({ label: x.date, value: x.unitGross / 100 }))} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.top")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            <th className={th}>{tr("super.products.product")}</th><th className={th}>{tr("super.products.category")}</th>
            <th className={`${th} text-right`}>{tr("super.products.times")}</th>
            <th className={`${th} text-right`}>{tr("super.products.qty")}</th>
            <th className={`${th} text-right`}>{tr("super.products.spent")}</th>
          </tr></thead>
          <tbody>
            {a.top.map(p => (
              <tr key={p.productId} className="border-t border-line">
                <td className="py-1">{p.name}</td><td>{tr(`productCategory.${p.category}`)}</td>
                <td className="text-right">{p.timesBought}</td>
                <td className="text-right">{qty(p.totalQtyMilli, p.unit)}</td>
                <td className="text-right font-mono">{fmtArsCents(p.totalSpentCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.habits")}</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <Habit title={tr("super.products.essentials")} products={a.frequency.essentials} tr={tr} />
          <Habit title={tr("super.products.frequent")} products={a.frequency.frequent} tr={tr} />
          <Habit title={tr("super.products.occasional")} products={a.frequency.occasional} tr={tr} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("super.products.basket")}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {([["super.products.entered", a.basket.entered], ["super.products.left", a.basket.left]] as const).map(([key, list]) => (
            <div key={key}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr(key)}</h3>
              <ul className="mt-1 text-sm">
                {list.length === 0 && <li className="text-ink-muted">{tr("super.products.nothing")}</li>}
                {list.map(b => <li key={b.productId} className="flex justify-between gap-4"><span>{b.name}</span><span className="font-mono">{fmtArsCents(b.netCents)}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.products.footer")}</p>
    </main>
  );
}
