import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { paymentFloat, taxBurden } from "@/lib/queries";
import { parseGranularity, periodWord } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtArs } from "@/lib/format";
import { Stat, StatRail } from "@/components/Stat";
import { FloatChart } from "@/components/FloatChart";

export const dynamic = "force-dynamic";

// No mode toggles: the float gain is a real-terms quantity by construction (see paymentFloat),
// so the whole page speaks constant base-month pesos.
export default async function Float({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const g = parseGranularity(sp);
  const cpi = loadCpi();
  const db = getDb();
  const periods = paymentFloat(db, cpi, g);
  const totalGain = periods.reduce((s, m) => s + m.gain, 0);
  const installmentGain = periods.reduce((s, m) => s + m.gainInstallment, 0);
  // Plain mean over buckets, not over rows: this reads "what a typical bucket looked like".
  const avgDays = periods.length ? periods.reduce((s, m) => s + m.avgDays, 0) / periods.length : null;
  // What the float cost, for the same window: the card's own financing interest, in real terms.
  const interest = taxBurden(db, { spend: "cash", value: "real", tax: "excl", cpi, mep: loadMep() })
    .reduce((s, m) => s + m.interest, 0);
  const tr = await getT();

  return (
    <main>
      <StatRail stats={
        <>
          <Stat
            label={tr("float.gain")}
            value={fmtArs(totalGain)}
            detail={<>
              {tr("float.gain.detail")}
              {totalGain > 0 && tr("float.gain.viaInstallments", {
                pct: ((installmentGain / totalGain) * 100).toFixed(0).replace(".", ","),
              })}
            </>}
          />
          <Stat
            label={tr("float.typical")}
            value={avgDays != null ? tr("float.typical.days", { days: avgDays.toFixed(0) }) : "—"}
            detail={tr("float.typical.detail", { period: periodWord(g, tr.locale) })}
          />
          <Stat label={tr("float.cost")} value={fmtArs(interest)} detail={tr("float.cost.detail")} />
        </>
      }>
        <FloatChart data={periods} />
        <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("float.note")}</p>
      </StatRail>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("float.footer")}</p>
    </main>
  );
}
