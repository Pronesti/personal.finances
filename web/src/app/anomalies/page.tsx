import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { reviewableAlerts, staleReviews, periodTotals } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
import { periodOf } from "@/lib/months";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { AnomalyTimeline } from "@/components/AnomalyTimeline";
import { reviewAlert } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  duplicate: "Duplicate", amount_jump: "Price jump", new_merchant: "New merchant",
  math_mismatch: "Statement math", balance_mismatch: "Balance mismatch",
};

export default async function Anomalies({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const db = getDb();
  const opts = valueOpts(modes);
  const alerts = reviewableAlerts(db, opts.cpi);
  const cleared = staleReviews(db, alerts);
  const totals = periodTotals(db, opts, g);
  const open = alerts.filter(a => a.state === "open");
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alerts</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        {open.length} open of {alerts.length} — statement-integrity checks (computed at ingest) and
        anomalies (recomputed every load).
        {cleared > 0 && ` Cleared ${cleared} review${cleared === 1 ? "" : "s"} whose alert no longer exists.`}
      </p>
      {/* Granularity moves the timeline only: the table below is a list of alerts, not a
          time series, so grouping it would hide the very rows this page exists to show. */}
      <Pills options={GRANULARITIES} current={g} href={x => withModes("/anomalies", modes, { g: x })} />
      <AnomalyTimeline
        totals={totals}
        flaggedPeriods={open.map(a => periodOf(a.month, g))}
        value={modes.value}
      />
      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">When</th><th>Kind</th><th>Merchant</th>
          <th className="text-right">Amount</th><th>What happened</th><th className="text-right">Review</th>
        </tr></thead>
        <tbody>
          {alerts.map(a => (
            <tr key={a.key} className={`border-t border-line ${a.state === "open" ? "" : "text-ink-subtle"}`}>
              <td className="whitespace-nowrap py-1">{a.date ?? a.month}</td>
              <td>{KIND_LABEL[a.kind] ?? a.kind}</td>
              <td>
                {a.merchant
                  ? <Link className="text-accent hover:underline" href={withModes("/categories", modes, { merchant: a.merchant })}>{a.merchant}</Link>
                  : "—"}
              </td>
              <td className="text-right">{a.amount != null ? fmtArs(a.amount) : "—"}</td>
              <td>{a.message}</td>
              <td className="whitespace-nowrap text-right">
                {a.state === "open" ? (
                  <>
                    <form action={reviewAlert} className="inline">
                      <input type="hidden" name="key" value={a.key} />
                      <input type="hidden" name="state" value="reviewed" />
                      <button className="text-accent hover:underline" type="submit">reviewed</button>
                    </form>
                    <span className="px-1">·</span>
                    <form action={reviewAlert} className="inline">
                      <input type="hidden" name="key" value={a.key} />
                      <input type="hidden" name="state" value="dismissed" />
                      <button className="text-ink-muted hover:text-ink hover:underline" type="submit">dismiss</button>
                    </form>
                  </>
                ) : (
                  <form action={reviewAlert} className="inline">
                    <input type="hidden" name="key" value={a.key} />
                    <input type="hidden" name="state" value="open" />
                    <button className="text-accent hover:underline" type="submit">{a.state} — reopen</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-ink-muted">
        Amounts are always the nominal pesos the card billed — that is what you would dispute. Review
        state is keyed to the statement and the alert&apos;s shape, not to a row id or its wording, so it
        survives re-uploading the statement under any name. Duplicates the statement already reversed
        start out reviewed; reopening one sticks. Price jumps are measured in real terms, and only for
        merchants billed exactly once a month, so a busier month at the supermarket is not mistaken for
        a price rise. Duplicate matching uses the ±2-day window Actual Budget uses for schedules, stays
        within one statement, and ignores installment rows.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the results of the checks on your statements. The checks find duplicate
        charges, price jumps, new merchants, and errors in the statement totals. The goal is to
        find problems early, when a dispute with the bank is possible. The chart marks the
        periods with open alerts; the pills group it by month, quarter, year, or all, and the
        table below always lists every alert. Read the table and examine each open alert. An alert is not
        always an error. It is a question. Mark an alert as reviewed when the charge is correct.
        Dismiss it when it is not important. Zero open alerts is good. An open balance or math
        alert is bad. It shows that the statement numbers do not agree.
      </p>
    </main>
  );
}
