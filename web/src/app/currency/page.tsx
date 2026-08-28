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
      <p className="text-xs text-ink-muted mt-3">
        USD-billed purchases are converted at each cycle month&apos;s average MEP rate so both bars
        share one unit. Foreign spending is lumpy — a travel month can dominate the year.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page compares your costs in pesos with your costs in US dollars. The goal is to show
        the weight of purchases in a foreign currency. The dollar amounts change to pesos at the
        MEP rate of each month. Thus the two bars have the same unit. A large dollar bar is not
        bad alone. It usually shows travel or purchases from other countries. But dollar
        purchases add the RG 5617 tax. See the Taxes page for that cost.
      </p>
    </main>
  );
}
