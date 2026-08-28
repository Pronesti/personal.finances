import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { currencySplit } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { CurrencyBars } from "@/components/CurrencyBars";

export const dynamic = "force-dynamic";

export default async function Currency({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const data = currencySplit(getDb(), opts, g);
  const tr = await getT();
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{tr("currency.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/currency", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <CurrencyBars data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("currency.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("currency.footer")}</p>
    </main>
  );
}
