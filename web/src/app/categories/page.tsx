import { Fragment } from "react";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { categoryDrill, coverage, merchantNames } from "@/lib/queries";
import { parseModes, parseGranularity, withModes, valueOpts, periodsFor, resolvePeriod } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import { DrillBars } from "@/components/DrillBars";
import { RecategorizeButton } from "@/components/RecategorizeButton";
import { MergeMerchantButton, MerchantNameList } from "@/components/MergeMerchantButton";

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
  // Every merchant, not just the ones this drill shows: a merge targets a name the current
  // filter has no reason to contain.
  const names = merchantNames(db);
  const tr = await getT();

  // A crumb names one level, so it carries only the scope and the filter down to that level —
  // the deeper filters are exactly what clicking it drops.
  const crumbHref = (extra: Record<string, string> = {}) =>
    withModes("/categories", modes, { g, period, ...extra });

  // The drill is an ordered path, so the crumbs are built by walking it and accumulating the
  // filters each level needs. Every crumb is the same thing — a link to one level — and they
  // are built from one list and rendered by one branch so that none of them can drift into
  // looking like something else.
  const crumbs = [{ key: "root", label: tr("categories.crumb.all"), href: crumbHref() }];
  const upToHere: Record<string, string> = {};
  for (const key of ["category", "subcategory", "merchant"] as const) {
    const value = filter[key];
    if (value == null) continue;
    upToHere[key] = value;
    const label = key === "category" ? tr(`category.${value as Category}`) : value;
    crumbs.push({ key, label, href: crumbHref({ ...upToHere }) });
  }

  // The transaction list only exists below the top level (or for a single merchant); without it
  // the chart has no neighbour to share an ultrawide row with.
  const showRows = level !== "category" || !!filter.merchant;

  return (
    <main>
      {/* Rendered at every level, drilled or not: this is the page's "you are here", and a row
          that only appeared once you drilled moved everything under it down. It used to sit
          directly beneath the granularity pills, where its root label read as a second, broken
          period row — the header owns those pills now, so it reads as the crumb it is.
          Every crumb looks the same at every depth, rather than the root turning from plain
          text into a link the moment you drill and the deepest one turning back: a row whose
          parts restyle themselves as you move through it reads as several controls instead of
          one path. The crumb for the level you are on points at that level, which costs
          nothing and keeps the row still. */}
      <div className="mb-4 flex gap-2 text-sm">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.key}>
            {i > 0 && <span>/</span>}
            <Link href={crumb.href} className="text-accent hover:underline">{crumb.label}</Link>
          </Fragment>
        ))}
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
                  <th className="text-right">{tr("categories.table.actions")}</th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                      {/* The merchant leads and the statement line sits under it: the merchant
                          is the name every other page groups by, and the raw line is what ties
                          the row back to the PDF. Both, because an alias renames the first and
                          must never look like it rewrote the second. */}
                      <td>
                        <span className="block">{r.merchant}</span>
                        <span className="block text-xs text-ink-subtle">{r.description}</span>
                      </td>
                      <td className="text-right">{r.amount != null ? fmtMoney(r.amount, modes.value) : "—"}</td>
                      <td className="text-right">{r.usd ?? "—"}</td>
                      <td className="text-right whitespace-nowrap">
                        <RecategorizeButton row={r} />
                        <span className="px-1.5 text-ink-subtle">·</span>
                        <MergeMerchantButton merchant={r.merchant} detail={r.description} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      {/* Rendered once for every merge dialog on the page — see MERCHANT_LIST_ID. */}
      <MerchantNameList names={names} />

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("categories.footer")}</p>
    </main>
  );
}
