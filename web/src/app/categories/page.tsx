import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { categoryDrill, coverage } from "@/lib/queries";
import { periodOf, type Granularity } from "@/lib/months";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, withModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Category } from "@/lib/categorize";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { DrillBars } from "@/components/DrillBars";

export const dynamic = "force-dynamic";

export default async function Categories({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const db = getDb();

  // coverage() comes back ordered by cycle month, so collapsing to period labels keeps them
  // chronological without a second sort — and dedupes the months sharing a quarter or year.
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  const period = typeof sp.period === "string" && periods.includes(sp.period)
    ? sp.period
    : periods.at(-1) ?? "";

  const filter = {
    category: typeof sp.category === "string" ? sp.category : undefined,
    subcategory: typeof sp.subcategory === "string" ? sp.subcategory : undefined,
    merchant: typeof sp.merchant === "string" ? sp.merchant : undefined,
  };
  const opts = valueOpts(modes);
  const { level, rows, groups } = categoryDrill(db, opts, { ...filter, granularity: g, period });
  const tr = await getT();

  // Changing the scope keeps you where you drilled to, and drilling keeps the scope.
  const drilled = Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v != null)
  ) as Record<string, string>;
  // The granularity links deliberately omit `period`: a month label is not a valid year, so
  // the new granularity re-defaults to its newest period rather than falling back to all-time.
  const granularityHref = (x: Granularity) => withModes("/categories", modes, { g: x, ...drilled });
  const periodHref = (p: string) => withModes("/categories", modes, { g, period: p, ...drilled });
  const crumbHref = (extra: Record<string, string> = {}) =>
    withModes("/categories", modes, { g, period, ...extra });

  // The transaction list only exists below the top level (or for a single merchant); without it
  // the chart has no neighbour to share an ultrawide row with.
  const showRows = level !== "category" || !!filter.merchant;

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("categories.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g} href={x => granularityHref(x as Granularity)}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      {/* One bucket at "all" granularity — a period picker with a single choice is noise. */}
      {g !== "all" && <Pills options={periods} current={period} href={periodHref} />}
      {/* A one-item breadcrumb has nowhere to go back to, and its root label sat directly under
          the granularity pills where "all" read as a second, broken period row. */}
      {Object.keys(drilled).length > 0 && (
        <div className="mb-4 flex gap-2 text-sm">
          <Link href={crumbHref()} className="text-accent hover:underline">{tr("categories.crumb.all")}</Link>
          {filter.category && <><span>/</span><Link href={crumbHref({ category: filter.category })} className="text-accent hover:underline">{tr(`category.${filter.category as Category}`)}</Link></>}
          {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
          {filter.merchant && <><span>/</span><span className="font-medium">{filter.merchant}</span></>}
        </div>
      )}
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
                </tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                      <td>{r.description}</td>
                      <td className="text-right">{r.amount != null ? fmtMoney(r.amount, modes.value) : "—"}</td>
                      <td className="text-right">{r.usd ?? "—"}</td>
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
