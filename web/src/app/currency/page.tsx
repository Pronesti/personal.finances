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
      <CurrencyBars data={data} value={modes.value} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("currency.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("currency.footer")}</p>
    </main>
  );
}
