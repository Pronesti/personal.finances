import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { categoryDrill, coverage } from "@/lib/queries";
import { periodOf, type Granularity } from "@/lib/months";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { DrillBars } from "@/components/DrillBars";

export const dynamic = "force-dynamic";

const GRANULARITIES: Granularity[] = ["month", "quarter", "year"];

const pill = (active: boolean) =>
  `rounded-md px-2 py-0.5 transition-colors ${
    active ? "bg-accent font-medium text-accent-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
  }`;

export default async function Categories({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g: Granularity = sp.g === "quarter" ? "quarter" : sp.g === "year" ? "year" : "month";
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

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Categories</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <div className="mb-2 flex flex-wrap gap-1 text-sm">
        {GRANULARITIES.map(x => (
          <Link key={x} href={granularityHref(x)} className={pill(x === g)}>{x}</Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 text-sm">
        {periods.map(p => (
          <Link key={p} href={periodHref(p)} className={pill(p === period)}>{p}</Link>
        ))}
      </div>
      <div className="mb-4 flex gap-2 text-sm">
        <Link href={crumbHref()} className="text-accent hover:underline">all</Link>
        {filter.category && <><span>/</span><Link href={crumbHref({ category: filter.category })} className="text-accent hover:underline">{filter.category}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
        {filter.merchant && <><span>/</span><span className="font-medium">{filter.merchant}</span></>}
      </div>
      {groups.length === 0
        ? <p className="text-sm text-ink-muted">No spending in {period || "any statement"}.</p>
        : <DrillBars groups={groups} level={level} value={modes.value} />}
      {(level !== "category" || filter.merchant) && (
        <table className="w-full text-sm mt-6">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">USD</th>
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
    </main>
  );
}
