import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { moneyBack, type CreditKind } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { CreditBars } from "@/components/CreditBars";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const KIND_LABEL: Record<CreditKind, string> = {
  promo: "bank promo", refund: "refund", taxback: "RG 5617 recovered",
};

export default async function Credits({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const { periods, top } = moneyBack(getDb(), opts, g);
  const total = periods.reduce((s, p) => s + p.total, 0);
  const rated = periods.filter(p => p.pctOfSpend != null) as (typeof periods[number] & { pctOfSpend: number })[];
  const avgRate = rated.length ? rated.reduce((s, p) => s + p.pctOfSpend, 0) / rated.length : null;

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Money back</h1>
        {/* spend toggle hidden: credits are billed lines, cash by nature; tax toggle: a credit is not taxed */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills options={GRANULARITIES} current={g} href={x => withModes("/credits", modes, { g: x })} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Total recovered</div>
          <div className="text-2xl font-bold">{fmtMoney(total, modes.value)}</div>
          <div className="text-sm text-ink-muted">promos, refunds and tax reversals, whole history</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Average give-back</div>
          <div className="text-2xl font-bold">{avgRate != null ? pct(avgRate) : "—"}</div>
          <div className="text-sm text-ink-muted">of each period&apos;s purchases came back</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Biggest credit</div>
          <div className="text-2xl font-bold">{top[0] ? fmtMoney(top[0].amount, modes.value) : "—"}</div>
          <div className="text-sm text-ink-muted">{top[0] ? `${top[0].merchant} · ${top[0].month}` : "no credits yet"}</div>
        </div>
      </div>

      <CreditBars data={periods} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        Everything the statements handed back: bank promos (BONIF / Visa Garpa lines), merchant
        refunds, and RG 5617 tax recovered when foreign spend was reversed. The spend pages net
        these against purchases silently — this is the one page where they are visible on their own.
        The dashed line is the give-back as a share of that period&apos;s purchases. Your own
        payments are never counted.
      </p>

      <h2 className="mb-3 text-lg font-semibold">Largest credits</h2>
      {top.length === 0
        ? <p className="text-sm text-ink-muted">No credits in the history yet.</p>
        : <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="py-1 pr-3">When</th><th className="pr-3">Merchant</th>
                <th className="pr-3">Kind</th><th className="pr-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {top.map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-3 text-ink-muted">{c.date ?? c.month}</td>
                  <td className="pr-3">{c.merchant}</td>
                  <td className="pr-3 text-ink-muted">{KIND_LABEL[c.kind]}</td>
                  <td className="pr-3 text-right">{fmtMoney(c.amount, modes.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the money that comes back to your statements. It contains bank
        promotions, merchant refunds, and recovered RG 5617 tax. The other pages subtract these
        credits without a display. This page makes them visible. Read the bars to see the
        credits of each period. Read the dashed line to see the credits as a share of the
        purchases of that period. A high share is good. It shows that promotions and refunds
        decrease your real cost. Your own card payments are not counted here.
      </p>
    </main>
  );
}
