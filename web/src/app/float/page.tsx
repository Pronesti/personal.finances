import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { paymentFloat, taxBurden } from "@/lib/queries";
import { fmtArs } from "@/lib/format";
import { FloatChart } from "@/components/FloatChart";

export const dynamic = "force-dynamic";

// No mode toggles: the float gain is a real-terms quantity by construction (see paymentFloat),
// so the whole page speaks constant base-month pesos.
export default async function Float() {
  const cpi = loadCpi();
  const db = getDb();
  const months = paymentFloat(db, cpi);
  const base = latestMonth(cpi);
  const totalGain = months.reduce((s, m) => s + m.gain, 0);
  const installmentGain = months.reduce((s, m) => s + m.gainInstallment, 0);
  const avgDays = months.length ? months.reduce((s, m) => s + m.avgDays, 0) / months.length : null;
  // What the float cost, for the same window: the card's own financing interest, in real terms.
  const interest = taxBurden(db, { spend: "cash", value: "real", tax: "excl", cpi, mep: loadMep() })
    .reduce((s, m) => s + m.interest, 0);

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Payment float</h1>
        <span className="text-xs text-ink-subtle">in {base} pesos</span>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Inflation gain</div>
          <div className="text-2xl font-bold">{fmtArs(totalGain)}</div>
          <div className="text-sm text-ink-muted">
            saved by paying later, whole history
            {totalGain > 0 && ` — ${((installmentGain / totalGain) * 100).toFixed(0).replace(".", ",")}% via installments`}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Typical float</div>
          <div className="text-2xl font-bold">{avgDays != null ? `${avgDays.toFixed(0)} days` : "—"}</div>
          <div className="text-sm text-ink-muted">from purchase to due date, typical month</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">What it cost</div>
          <div className="text-2xl font-bold">{fmtArs(interest)}</div>
          <div className="text-sm text-ink-muted">financing interest paid over the same statements</div>
        </div>
      </div>

      <FloatChart data={months} />
      <p className="mt-3 text-xs text-ink-muted">
        Every peso on a statement is paid at the due date, weeks or months after the purchase — and
        in between, inflation shrinks it. Bars are the real value preserved by that delay, split into
        ordinary purchases (a few weeks of float) and installment plans, whose fixed nominal payments
        ride the full plan length. The dashed line is the amount-weighted purchase-to-due delay. The
        newest month&apos;s gain is understated: its due date falls past the CPI series, so the last
        known index stands in. Gains are measured against the official IPC — a private-index month
        would move the true figure.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the money that inflation removes from your card debt before you pay it.
        You pay each purchase weeks or months after you make it. In that time, inflation
        decreases the real value of the payment. This is the float gain. Read the bars to see
        the gain of each month. Read the dashed line to see the usual delay in days. Then
        compare the total gain with the interest cost in the third tile. The float is good when
        the gain is more than the interest. Installment plans give the largest gain, because
        their payments stay at the same nominal amount for many months.
      </p>
    </main>
  );
}
