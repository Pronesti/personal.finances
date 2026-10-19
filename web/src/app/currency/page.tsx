import { PageGuide } from "@/components/PageGuide";
import { getDb } from "@/lib/db";
import { currencySplit } from "@/lib/queries";
import { parseModes, parseGranularity, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
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
      <div className="mb-6">
        <PageGuide summary={tr("currency.purpose")} detail={tr("currency.footer")} />
      </div>
      <CurrencyBars data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("currency.note")}</p>
    </main>
  );
}
