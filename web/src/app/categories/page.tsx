import Link from "next/link";
import { getDb } from "@/lib/db";
import { categoryDrill, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, withModes, valueOpts, periodsFor, resolvePeriod } from "@/lib/params";
import { getT } from "@/lib/locale";
import { CATEGORIES, type Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import { DrillBars } from "@/components/DrillBars";
import { RecategorizeButton } from "@/components/RecategorizeButton";

export const dynamic = "force-dynamic";

export default async function Categories({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const db = getDb();

  // The same two functions the chrome uses, so the page and its period pills can never disagree
  // about which period is selected.
  const period = resolvePeriod(periodsFor(coverage(db).map(c => c.month), g), sp.period, "latest");

  const filter = {
    category: typeof sp.category === "string" ? sp.category : undefined,
    subcategory: typeof sp.subcategory === "string" ? sp.subcategory : undefined,
    merchant: typeof sp.merchant === "string" ? sp.merchant : undefined,
  };
  const opts = valueOpts(modes);
  const { level, rows, groups } = categoryDrill(db, opts, { ...filter, granularity: g, period });
  const tr = await getT();

  // A crumb names one level, so it carries only the scope and the filter down to that level —
  // the deeper filters are exactly what clicking it drops.
  const crumbHref = (extra: Record<string, string> = {}) =>
    withModes("/categories", modes, { g, period, ...extra });

  // The transaction list only exists below the top level (or for a single merchant); without it
  // the chart has no neighbour to share an ultrawide row with.
  const showRows = level !== "category" || !!filter.merchant;

  return (
    <main>
      {/* Rendered at every level, drilled or not: this is the page's "you are here", and a row
          that only appeared once you drilled moved everything under it down. It used to sit
          directly beneath the granularity pills, where its root label read as a second, broken
          period row — the header owns those pills now, so it reads as the crumb it is.
          The root keeps one look at every depth, rather than turning from plain text into a
          link the moment you drill: a crumb that restyles itself as you move reads as a
          different control. At the root it simply points at the level you are already on. */}
      <div className="mb-4 flex gap-2 text-sm">
        <Link href={crumbHref()} className="text-accent hover:underline">{tr("categories.crumb.all")}</Link>
        {filter.category && <><span>/</span><Link href={crumbHref({ category: filter.category })} className="text-accent hover:underline">{tr(`category.${filter.category as Category}`)}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
        {filter.merchant && <><span>/</span><span className="font-medium">{filter.merchant}</span></>}
      </div>
      {groups.length === 0
        ? <p className="text-sm text-ink-muted">
            {tr("categories.empty", {
              period: g === "all" ? tr("categories.empty.any") : period || tr("categories.empty.any"),
            })}
          </p>
        : (
          // A horizontal bar reads no better for being 2000px long, so the chart keeps a sane
          // width and the ultrawide leftover goes to the transactions beside it.
          <div className={`grid gap-8 ${showRows ? "3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 3xl:items-start" : "max-w-[90rem]"}`}>
            <DrillBars groups={groups} level={level} value={modes.value} />
            {showRows && (
              <table className="mt-6 w-full text-sm 3xl:mt-0">
                <thead><tr className="border-b border-line text-left text-ink-muted">
                  <th className="py-1">{tr("categories.table.date")}</th><th>{tr("categories.table.description")}</th>
                  <th className="text-right">{tr("categories.table.amount")}</th><th className="text-right">{tr("categories.table.usd")}</th>
                  <th className="text-right">{tr("categories.table.rule")}</th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                      <td>{r.description}</td>
                      <td className="text-right">{r.amount != null ? fmtMoney(r.amount, modes.value) : "—"}</td>
                      <td className="text-right">{r.usd ?? "—"}</td>
                      <td className="text-right whitespace-nowrap">
                        <RecategorizeButton row={r} categories={CATEGORIES} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("categories.footer")}</p>
    </main>
  );
}
