import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { currencySplit } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { ModeToggle } from "@/components/ModeToggle";
import { CurrencyBars } from "@/components/CurrencyBars";

export const dynamic = "force-dynamic";

export default async function Currency({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = currencySplit(getDb(), opts);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">ARS vs USD spending</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <CurrencyBars data={data} value={modes.value} />
      <p className="text-xs text-zinc-500 mt-3">
        USD-billed purchases are converted at each cycle month&apos;s average MEP rate so both bars
        share one unit. Foreign spending is lumpy — a travel month can dominate the year.
      </p>
    </main>
  );
}
