import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { taxBurden } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, periodWord, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { Stat, StatRail } from "@/components/Stat";
import { TaxBars } from "@/components/TaxBars";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Taxes({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const data = taxBurden(getDb(), opts, g);
  const total = data.reduce((s, m) => s + m.total, 0);
  const rates = data.filter(m => m.ratePct != null) as (typeof data[number] & { ratePct: number })[];
  const avgRate = rates.length ? rates.reduce((s, m) => s + m.ratePct, 0) / rates.length : null;
  const worst = rates.length ? rates.reduce((a, b) => (b.ratePct > a.ratePct ? b : a)) : null;
  const tr = await getT();
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("taxes.title")}</h1>
        {/* tax toggle hidden: this page IS the tax view — "true cost" would double-count */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/taxes", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />

      <StatRail stats={
        <>
          <Stat label={tr("taxes.total")} value={fmtMoney(total, modes.value)} detail={tr("taxes.total.detail")} />
          <Stat
            label={tr("taxes.average")}
            value={avgRate != null ? pct(avgRate) : "—"}
            detail={tr("taxes.average.detail", { period: periodWord(g, tr.locale) })}
          />
          <Stat
            label={tr("taxes.worst", { period: periodWord(g, tr.locale) })}
            value={worst ? pct(worst.ratePct) : "—"}
            detail={worst ? worst.period : tr("taxes.worst.none")}
          />
        </>
      }>
        <TaxBars data={data} value={modes.value} />
        <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("taxes.note")}</p>
      </StatRail>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("taxes.footer")}</p>
    </main>
  );
}
