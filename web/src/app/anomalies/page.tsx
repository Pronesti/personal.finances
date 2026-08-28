import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { reviewableAlerts, staleReviews, periodTotals } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, granularityLabel, valueOpts, withModes } from "@/lib/params";
import { getT } from "@/lib/locale";
import type { MessageKey } from "@/lib/i18n";
import type { Granularity } from "@/lib/months";
import { periodOf } from "@/lib/months";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { AnomalyTimeline } from "@/components/AnomalyTimeline";
import { reviewAlert } from "./actions";

export const dynamic = "force-dynamic";

const KIND_KEY: Record<string, MessageKey> = {
  duplicate: "anomalies.kind.duplicate", amount_jump: "anomalies.kind.amount_jump",
  new_merchant: "anomalies.kind.new_merchant", math_mismatch: "anomalies.kind.math_mismatch",
  balance_mismatch: "anomalies.kind.balance_mismatch",
};

const STATE_KEY: Record<string, MessageKey> = {
  open: "anomalies.state.open", reviewed: "anomalies.state.reviewed",
  dismissed: "anomalies.state.dismissed",
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
  const tr = await getT();
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("anomalies.title")}</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        {tr("anomalies.summary", { open: open.length, total: alerts.length })}
        {cleared > 0 && tr.plural("anomalies.cleared", cleared)}
      </p>
      {/* Granularity moves the timeline only: the table below is a list of alerts, not a
          time series, so grouping it would hide the very rows this page exists to show. */}
      <Pills
        options={GRANULARITIES} current={g}
        href={x => withModes("/anomalies", modes, { g: x })}
        label={x => granularityLabel(x as Granularity, tr.locale)}
      />
      <AnomalyTimeline
        totals={totals}
        flaggedPeriods={open.map(a => periodOf(a.month, g))}
        value={modes.value}
      />
      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{tr("anomalies.table.when")}</th><th>{tr("anomalies.table.kind")}</th>
          <th>{tr("anomalies.table.merchant")}</th>
          <th className="text-right">{tr("anomalies.table.amount")}</th><th>{tr("anomalies.table.what")}</th>
          <th className="text-right">{tr("anomalies.table.review")}</th>
        </tr></thead>
        <tbody>
          {alerts.map(a => (
            <tr key={a.key} className={`border-t border-line ${a.state === "open" ? "" : "text-ink-subtle"}`}>
              <td className="whitespace-nowrap py-1">{a.date ?? a.month}</td>
              <td>{KIND_KEY[a.kind] ? tr(KIND_KEY[a.kind]) : a.kind}</td>
              <td>
                {a.merchant
                  ? <Link className="text-accent hover:underline" href={withModes("/categories", modes, { merchant: a.merchant })}>{a.merchant}</Link>
                  : "—"}
              </td>
              <td className="text-right">{a.amount != null ? fmtArs(a.amount) : "—"}</td>
              {/* Anomalies carry a key; ingest-time integrity alerts keep their stored wording. */}
              <td>{a.messageKey ? tr(a.messageKey, a.messageParams) : a.message}</td>
              <td className="whitespace-nowrap text-right">
                {a.state === "open" ? (
                  <>
                    <form action={reviewAlert} className="inline">
                      <input type="hidden" name="key" value={a.key} />
                      <input type="hidden" name="state" value="reviewed" />
                      <button className="text-accent hover:underline" type="submit">{tr("anomalies.action.reviewed")}</button>
                    </form>
                    <span className="px-1">·</span>
                    <form action={reviewAlert} className="inline">
                      <input type="hidden" name="key" value={a.key} />
                      <input type="hidden" name="state" value="dismissed" />
                      <button className="text-ink-muted hover:text-ink hover:underline" type="submit">{tr("anomalies.action.dismiss")}</button>
                    </form>
                  </>
                ) : (
                  <form action={reviewAlert} className="inline">
                    <input type="hidden" name="key" value={a.key} />
                    <input type="hidden" name="state" value="open" />
                    <button className="text-accent hover:underline" type="submit">{tr("anomalies.action.reopen", { state: tr(STATE_KEY[a.state]) })}</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("anomalies.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("anomalies.footer")}</p>
    </main>
  );
}
