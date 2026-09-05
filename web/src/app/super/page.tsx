import { getDb } from "@/lib/db";
import { loadFacts } from "@/lib/receipts/facts";
import { valueFacts } from "@/lib/receipts/value";
import { buildAnalytics } from "@/lib/receipts/analytics";
import { fmtMoneyCents } from "@/lib/receipts/money";
import { fmtPct } from "@/lib/format";
import { Stat, StatRail } from "@/components/Stat";
import { SuperSpendBars } from "@/components/SuperSpendBars";
import { SuperIndexLines } from "@/components/SuperIndexLines";
import { SuperSavingsBars } from "@/components/SuperSavingsBars";
import { getT } from "@/lib/locale";
import { parseModes, valueOpts, type SP } from "@/lib/params";

export const dynamic = "force-dynamic";

// Receipts are labelled by their date on every axis; "week N" is only an index.
const label = (date: string) => date.slice(5);

export default async function SuperOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const tr = await getT();
  const modes = parseModes(await searchParams);
  const { receipts, items } = valueFacts(loadFacts(getDb()), valueOpts(modes));
  const a = buildAnalytics(receipts, items);
  if (!a.kpis) return <main><p className="text-sm text-ink-muted">{tr("super.empty")}</p></main>;
  const k = a.kpis;
  const gross = a.periods.reduce((s, p) => s + p.grossCents, 0);
  return (
    <main>
      <StatRail stats={
        <>
          <Stat label={tr("super.stat.last")} value={fmtMoneyCents(k.lastTotalCents, modes.value)}
            detail={k.deltaPct === null ? tr("super.stat.first") : tr("super.stat.vsPrev", { pct: fmtPct(k.deltaPct) })}
            tone={k.deltaPct === null ? undefined : k.deltaPct > 0 ? "text-negative" : "text-positive"} />
          <Stat label={tr("super.stat.avg")} value={fmtMoneyCents(Math.round(k.avgTotalCents), modes.value)}
            detail={tr("super.stat.monthly", { amount: fmtMoneyCents(Math.round(k.monthlyProjectionCents), modes.value), count: k.nPeriods })} />
          <Stat label={tr("super.stat.saved")} value={fmtMoneyCents(k.accumulatedSavingsCents, modes.value)}
            detail={tr("super.stat.savedDetail", { pct: fmtPct(gross === 0 ? 0 : k.accumulatedSavingsCents * 100 / gross), gross: fmtMoneyCents(gross, modes.value) })} />
        </>
      }>
        <section className="space-y-8">
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.spend")}</h2>
            <SuperSpendBars data={a.periods.map(p => ({ label: label(p.date), paid: p.totalCents / 100, discount: -p.discountsCents / 100 }))} value={modes.value} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.index")}</h2>
            <SuperIndexLines data={a.index.map(p => ({ label: label(p.date), list: p.list, effective: p.effective }))} />
            <p className="mt-1 text-xs text-ink-muted">{tr("super.chart.indexNote")}</p>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">{tr("super.chart.savings")}</h2>
            <SuperSavingsBars data={a.periods.map(p => ({ label: label(p.date), mp: -p.mpCents / 100, coto: -p.cotoCents / 100, mixed: -p.mixedCents / 100 }))} value={modes.value} />
          </div>
        </section>
      </StatRail>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("super.footer")}</p>
    </main>
  );
}
