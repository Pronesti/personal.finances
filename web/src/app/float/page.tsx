import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { paymentFloat, taxBurden } from "@/lib/queries";
import { parseGranularity, GRANULARITIES, granularityLabel, periodWord } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { Granularity } from "@/lib/months";
import { fmtArs } from "@/lib/format";
import { Pills } from "@/components/Pills";
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
  const base = latestMonth(cpi);
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("float.title")}</h1>
        <span className="text-xs text-ink-subtle">{tr("mode.inPesos", { month: base })}</span>
      </div>

      <Pills
        options={GRANULARITIES} current={g} href={x => `/float?g=${x}`}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("float.gain")}</div>
          <div className="text-2xl font-bold">{fmtArs(totalGain)}</div>
          <div className="text-sm text-ink-muted">
            {tr("float.gain.detail")}
            {totalGain > 0 && tr("float.gain.viaInstallments", {
              pct: ((installmentGain / totalGain) * 100).toFixed(0).replace(".", ","),
            })}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("float.typical")}</div>
          <div className="text-2xl font-bold">{avgDays != null ? tr("float.typical.days", { days: avgDays.toFixed(0) }) : "—"}</div>
          <div className="text-sm text-ink-muted">{tr("float.typical.detail", { period: periodWord(g, tr.locale) })}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("float.cost")}</div>
          <div className="text-2xl font-bold">{fmtArs(interest)}</div>
          <div className="text-sm text-ink-muted">{tr("float.cost.detail")}</div>
        </div>
      </div>

      <FloatChart data={periods} />
      <p className="mt-3 text-xs text-ink-muted">{tr("float.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("float.footer")}</p>
    </main>
  );
}
