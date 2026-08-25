import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { anomalies, monthlyTotals } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { fmtArs } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { AnomalyTimeline } from "@/components/AnomalyTimeline";

export const dynamic = "force-dynamic";

const KIND_LABEL = {
  duplicate: "Duplicate", amount_jump: "Price jump", new_merchant: "New merchant",
} as const;

export default async function Anomalies({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const db = getDb();
  const opts = valueOpts(modes);
  const found = anomalies(db, opts.cpi);
  const totals = monthlyTotals(db, opts);
  const flaggedMonths = found.filter(a => !a.resolved).map(a => a.month);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Anomalies</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <AnomalyTimeline totals={totals} flaggedMonths={flaggedMonths} value={modes.value} />
      <table className="w-full text-sm mt-6">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">When</th><th>Kind</th><th>Merchant</th>
          <th className="text-right">Amount</th><th>What happened</th>
        </tr></thead>
        <tbody>
          {found.map((a, i) => (
            <tr key={i} className={`border-t border-zinc-100 dark:border-zinc-800 ${a.resolved ? "text-zinc-400" : ""}`}>
              <td className="py-1 whitespace-nowrap">{a.date ?? a.month}</td>
              <td>{KIND_LABEL[a.kind]}</td>
              <td>{a.merchant}</td>
              <td className="text-right">{fmtArs(a.amount)}</td>
              <td>{a.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-zinc-500 mt-3">
        Amounts in this table are always the nominal pesos the card billed — that is what you would
        dispute. Greyed rows already resolved themselves on the statement. Price jumps are measured
        in real terms, and only for merchants billed exactly once a month, so a busier month at the
        supermarket is not mistaken for a price rise. Duplicate matching uses the ±2-day window
        Actual Budget uses for schedules, stays within one statement, and ignores installment rows,
        which every statement re-lists at their original purchase date.
      </p>
    </main>
  );
}
