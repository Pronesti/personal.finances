import { getDb } from "@/lib/db";
import { recurringTable } from "@/lib/queries";
import { fmtArs, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Recurring() {
  const rows = recurringTable(getDb());
  return (
    <main>
      <h1 className="text-xl font-semibold mb-4">Recurring charges</h1>
      <p className="text-sm text-zinc-500 mb-4">Nominal amounts — % change vs previous month is the inflation/price-hike signal. USD-billed subscriptions tracked separately.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-zinc-500">
          <th className="py-1">Merchant</th><th>Currency</th><th className="text-right">Months seen</th>
          <th className="text-right">Last amount</th><th className="text-right">Change</th>
          <th className="text-right">Next expected</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.merchant}|${r.currency}`} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1">{r.merchant}</td>
              <td>{r.currency}</td>
              <td className="text-right">{r.occurrences}</td>
              <td className="text-right">{r.currency === "ARS" ? fmtArs(r.lastAmount) : `US$ ${r.lastAmount.toFixed(2)}`}</td>
              <td className={`text-right ${r.pctChange != null && r.pctChange > 10 ? "text-red-600 font-medium" : ""}`}>{fmtPct(r.pctChange)}</td>
              <td className="text-right">{r.nextExpectedMonth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
