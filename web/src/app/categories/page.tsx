import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { categoryDrill } from "@/lib/queries";
import { parseModes, withModes, valueOpts } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
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
    merchant: typeof sp.merchant === "string" ? sp.merchant : undefined,
  };
  const opts = valueOpts(modes);
  const { level, rows, groups } = categoryDrill(getDb(), opts, filter);
  return (
    <main>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Categories</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <div className="text-sm mb-4 flex gap-2">
        <Link href={withModes("/categories", modes)} className="hover:underline">all</Link>
        {filter.category && <><span>/</span><Link href={withModes("/categories", modes, { category: filter.category })} className="hover:underline">{filter.category}</Link></>}
        {filter.subcategory && <><span>/</span><span className="font-medium">{filter.subcategory}</span></>}
        {filter.merchant && <><span>/</span><span className="font-medium">{filter.merchant}</span></>}
      </div>
      <DrillBars groups={groups} level={level} value={modes.value} />
      {(level !== "category" || filter.merchant) && (
        <table className="w-full text-sm mt-6">
          <thead><tr className="text-left text-zinc-500">
            <th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">USD</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
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
