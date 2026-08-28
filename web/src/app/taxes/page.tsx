import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { taxBurden } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, periodWord, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
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

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("taxes.total")}</div>
          <div className="text-2xl font-bold">{fmtMoney(total, modes.value)}</div>
          <div className="text-sm text-ink-muted">{tr("taxes.total.detail")}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("taxes.average")}</div>
          <div className="text-2xl font-bold">{avgRate != null ? pct(avgRate) : "—"}</div>
          <div className="text-sm text-ink-muted">{tr("taxes.average.detail", { period: periodWord(g, tr.locale) })}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("taxes.worst", { period: periodWord(g, tr.locale) })}</div>
          <div className="text-2xl font-bold">{worst ? pct(worst.ratePct) : "—"}</div>
          <div className="text-sm text-ink-muted">{worst ? worst.period : tr("taxes.worst.none")}</div>
        </div>
      </div>

      <TaxBars data={data} value={modes.value} />
      <p className="mt-3 text-xs text-ink-muted">{tr("taxes.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("taxes.footer")}</p>
    </main>
  );
}
