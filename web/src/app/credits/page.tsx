import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { moneyBack, type CreditKind } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { MessageKey } from "@/lib/i18n";
import type { Granularity } from "@/lib/months";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { Stat, StatRail } from "@/components/Stat";
import { CreditBars } from "@/components/CreditBars";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const KIND_KEY: Record<CreditKind, MessageKey> = {
  promo: "credits.kind.promo", refund: "credits.kind.refund", taxback: "credits.kind.taxback",
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
  const tr = await getT();

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("credits.title")}</h1>
        {/* spend toggle hidden: credits are billed lines, cash by nature; tax toggle: a credit is not taxed */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/credits", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />

      <StatRail stats={
        <>
          <Stat label={tr("credits.total")} value={fmtMoney(total, modes.value)} detail={tr("credits.total.detail")} />
          <Stat
            label={tr("credits.average")}
            value={avgRate != null ? pct(avgRate) : "—"}
            detail={tr("credits.average.detail")}
          />
          <Stat
            label={tr("credits.biggest")}
            value={top[0] ? fmtMoney(top[0].amount, modes.value) : "—"}
            detail={top[0] ? `${top[0].merchant} · ${top[0].month}` : tr("credits.biggest.none")}
          />
        </>
      }>
        <CreditBars data={periods} value={modes.value} />
        <p className="mb-8 mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("credits.note")}</p>

        <h2 className="mb-3 text-lg font-semibold">{tr("credits.largestHeading")}</h2>
        {top.length === 0
          ? <p className="text-sm text-ink-muted">{tr("credits.none")}</p>
          : <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <th className="py-1 pr-3">{tr("credits.table.when")}</th><th className="pr-3">{tr("credits.table.merchant")}</th>
                  <th className="pr-3">{tr("credits.table.kind")}</th><th className="pr-3 text-right">{tr("credits.table.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((c, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-3 text-ink-muted">{c.date ?? c.month}</td>
                    <td className="pr-3">{c.merchant}</td>
                    <td className="pr-3 text-ink-muted">{tr(KIND_KEY[c.kind])}</td>
                    <td className="pr-3 text-right">{fmtMoney(c.amount, modes.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </StatRail>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("credits.footer")}</p>
    </main>
  );
}
