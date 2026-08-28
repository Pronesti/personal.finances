import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { taxBurden } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, periodWord, valueOpts, withModes } from "@/lib/params";
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
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Taxes &amp; card charges</h1>
        {/* tax toggle hidden: this page IS the tax view — "true cost" would double-count */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills options={GRANULARITIES} current={g} href={x => withModes("/taxes", modes, { g: x })} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Total paid</div>
          <div className="text-2xl font-bold">{fmtMoney(total, modes.value)}</div>
          <div className="text-sm text-ink-muted">in taxes and charges, whole history</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Average overhead</div>
          <div className="text-2xl font-bold">{avgRate != null ? pct(avgRate) : "—"}</div>
          <div className="text-sm text-ink-muted">on top of each {periodWord(g)}&apos;s purchases</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Worst {periodWord(g)}</div>
          <div className="text-2xl font-bold">{worst ? pct(worst.ratePct) : "—"}</div>
          <div className="text-sm text-ink-muted">{worst ? worst.period : "no tax lines yet"}</div>
        </div>
      </div>

      <TaxBars data={data} value={modes.value} />
      <p className="mt-3 text-xs text-ink-muted">
        Bars are the statement&apos;s own tax and charge lines by levy; the dashed line is their total
        as a percentage of that period&apos;s purchases (USD purchases counted at MEP, since RG 5617
        is charged on exactly those). DEVOLUCION DE SALDOS lines are balance transfers, not taxes,
        and are excluded. A spike in RG 5617 is a foreign-spend month, not a rate change.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the taxes and the charges that the bank adds to your card statements.
        These amounts are not purchases. You pay them because of the purchases you make. The goal
        of this analysis is to show the real extra cost of the use of the card. Read the bars to
        see the amount of each tax type in each period. Read the dashed line to see the total of
        these costs as a percentage of the purchases of the same period. A low and stable
        percentage is good. A percentage that increases is bad, because a larger part of your
        money goes to taxes and not to goods. A high RG 5617 bar is usually not bad. It shows a
        period with purchases in a foreign currency.
      </p>
    </main>
  );
}
