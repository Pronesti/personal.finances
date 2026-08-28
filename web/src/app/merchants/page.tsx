import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { merchantConcentration, merchantNovelty, coverage } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
import { periodOf, ALL_PERIOD } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { ParetoBars } from "@/components/ParetoBars";
import { NoveltyBars } from "@/components/NoveltyBars";

export const dynamic = "force-dynamic";

const TOP_CHART = 20;
const TOP_TABLE = 15;

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Merchants({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const periods = [...new Set(coverage(db).map(c => periodOf(c.month, g)))];
  // ALL_PERIOD is the default and the fallback for a period label from another granularity —
  // switching granularity deliberately drops `period` back to the full history.
  const period = typeof sp.period === "string" && periods.includes(sp.period) ? sp.period : ALL_PERIOD;
  const scope = period === ALL_PERIOD ? undefined : { granularity: g, period };
  const { merchants, totalSpend } = merchantConcentration(db, opts, scope);
  const novelty = merchantNovelty(db, opts, g);
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Merchant concentration</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>

      <Pills options={GRANULARITIES} current={g} href={x => withModes("/merchants", modes, { g: x })} />
      {/* At "all" granularity every month is already one bucket, so the scope row would offer
          "all" and nothing else — the granularity pill has said it. */}
      {g !== "all" && (
        <Pills
          options={[ALL_PERIOD, ...periods]}
          current={period}
          href={p => withModes("/merchants", modes, p === ALL_PERIOD ? { g } : { g, period: p })}
        />
      )}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Merchants</div>
          <div className="text-2xl font-bold">{merchants.length}</div>
          <div className="text-sm text-ink-muted">{period === ALL_PERIOD ? "across the whole history" : `in ${period}`}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Top 5 take</div>
          <div className="text-2xl font-bold">{merchants.length >= 5 ? pct(merchants[4].cumShare) : "—"}</div>
          <div className="text-sm text-ink-muted">of {fmtMoney(totalSpend, modes.value)} total</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Top 20 take</div>
          <div className="text-2xl font-bold">{merchants.length >= 20 ? pct(merchants[19].cumShare) : "—"}</div>
          <div className="text-sm text-ink-muted">rest is the long tail</div>
        </div>
      </div>

      <ParetoBars data={merchants.slice(0, TOP_CHART)} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        Bars are the top {TOP_CHART} merchants, colored by dominant category; the dashed line is the
        cumulative share of ALL spending, so where it crosses 50% tells you how few merchants take
        half your money. Refunds net against each merchant.
      </p>

      <h2 className="mb-3 text-lg font-semibold">New vs returning merchants</h2>
      <NoveltyBars data={novelty} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        &ldquo;First-time&rdquo; means the merchant had never appeared on any earlier statement. The
        first covered period is structurally all first-time. A fat blue band is exploration —
        or a spending spree at places you don&apos;t normally shop.
      </p>

      <h2 className="mb-3 text-lg font-semibold">Top {TOP_TABLE}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
            <th className="py-1 pr-3">Merchant</th><th className="pr-3">Category</th>
            <th className="pr-3 text-right">Total</th><th className="pr-3 text-right">Charges</th>
            <th className="pr-3 text-right">Share</th><th className="pr-3">Active</th>
          </tr>
        </thead>
        <tbody>
          {merchants.slice(0, TOP_TABLE).map(m => (
            <tr key={m.merchant} className="border-t border-line">
              <td className="py-1 pr-3">
                <Link href={withModes("/categories", modes, { merchant: m.merchant })} className="text-accent hover:underline">
                  {m.merchant}
                </Link>
              </td>
              <td className="pr-3 text-ink-muted">{m.category}</td>
              <td className="pr-3 text-right">{fmtMoney(m.total, modes.value)}</td>
              <td className="pr-3 text-right">{m.count}</td>
              <td className="pr-3 text-right">{pct(m.share)}</td>
              <td className="pr-3 text-ink-muted">
                {m.firstMonth === m.lastMonth ? m.firstMonth : `${m.firstMonth} – ${m.lastMonth}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows how your money divides across merchants. The goal of this analysis is to
        show if a small group of merchants gets a large part of your money. Read the bars to see
        the top merchants by total. Read the dashed line to see the cumulative share of all your
        costs. The point where the line crosses 50% shows the number of merchants that get half
        of your money. Concentration alone is not good or bad. Concentration in merchants that
        you selected, for example a supermarket, is normal. Concentration in one merchant that
        you do not know well is a signal. Examine that merchant. The second chart compares new
        merchants with known merchants. A large first-time band shows exploration, or purchases
        that are not part of your normal pattern.
      </p>
    </main>
  );
}
