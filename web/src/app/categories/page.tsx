import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { categoryDrill } from "@/lib/queries";
import { parseModes, withModes } from "@/lib/params";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { DrillBars } from "@/components/DrillBars";

export const dynamic = "force-dynamic";

export default async function Categories({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const filter = {
    category: typeof sp.category === "string" ? sp.category : undefined,
    subcategory: typeof sp.subcategory === "string" ? sp.subcategory : undefined,
    month: typeof sp.month === "string" ? sp.month : undefined,
  };
  const cpi = loadCpi();
  const { level, rows, groups } = categoryDrill(getDb(), { ...modes, cpi }, filter);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Categories</h1>
        <ModeToggle spend={modes.spend} value={modes.value} baseMonth={latestMonth(cpi)} />
      </div>
      <div className="text-sm mb-4 flex gap-2">
        <Link href={withModes("/categories", modes)} className="hover:underline">all</Link>
        {filter.category && <><span>/</span><Link href={withModes("/categories", modes, { category: filter.category })} className="hover:underline">{filter.category}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
      </div>
      <DrillBars groups={groups} level={level} />
      {level !== "category" && (
        <table className="w-full text-sm mt-6">
          <thead><tr className="text-left text-zinc-500">
            <th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">USD</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 whitespace-nowrap">{r.date ?? r.month}</td>
                <td>{r.description}</td>
                <td className="text-right">{r.amount != null ? fmtArs(r.amount) : "—"}</td>
                <td className="text-right">{r.usd ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
