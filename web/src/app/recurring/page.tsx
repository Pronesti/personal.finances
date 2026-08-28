import { getDb } from "@/lib/db";
import { recurringTable } from "@/lib/queries";
import { fmtArs, fmtPct } from "@/lib/format";
import { loadCpi } from "@/lib/cpi";
import { loadMep, mepFor, type MepTable } from "@/lib/mep";
import type { RecurringCharge } from "@/lib/recurring";

export const dynamic = "force-dynamic";

function amount(r: RecurringCharge) {
  return r.currency === "ARS" ? fmtArs(r.lastAmount) : `US$ ${r.lastAmount.toFixed(2)}`;
}

// Each USD charge is converted at the MEP of the month it last billed, the same convention
// toMode() uses — never at today's rate, which would reprice history.
function totals(rows: RecurringCharge[], mep: MepTable) {
  const ars = rows.filter(r => r.currency === "ARS").reduce((s, r) => s + r.lastAmount, 0);
  const usd = rows.filter(r => r.currency === "USD").reduce((s, r) => s + r.lastAmount, 0);
  const usdAsArs = rows
    .filter(r => r.currency === "USD")
    .reduce((s, r) => s + r.lastAmount * mepFor(r.lastMonth, mep), 0);
  return { ars, usd, combined: ars + usdAsArs };
}

function Table({ rows, mep, lapsed }: { rows: RecurringCharge[]; mep: MepTable; lapsed?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">None.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-line text-left text-ink-muted">
        <th className="py-1">Merchant</th><th>Currency</th><th className="text-right">Months seen</th>
        <th className="text-right">Last amount</th><th className="text-right">Change</th>
        <th className="text-right">{lapsed ? "Last seen" : "Next expected"}</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.merchant} className="border-t border-line">
            <td className="py-1">
              {r.merchant}
              {r.currencies.length > 1 && (
                <span className="ml-2 text-xs text-ink-muted">
                  billing moved {r.currencies.filter(c => c !== r.currency)[0]} → {r.currency}
                </span>
              )}
            </td>
            <td>
              {r.currency}
              {/* Pegged vs indexed is an ARS distinction — it is inflation that forces the
                  choice. In USD both regimes just mean "steady", so the badge would mislead. */}
              {r.currency === "ARS" && r.priceRegime && (
                <span className="ml-2 text-xs text-ink-muted" title={r.priceRegime === "pegged"
                  ? "Holds the same nominal price for months at a time"
                  : "Repriced monthly, flat once deflated by CPI"}>{r.priceRegime}</span>
              )}
            </td>
            <td className="text-right">{r.occurrences}</td>
            <td className="text-right">{amount(r)}</td>
            <td className={`text-right ${r.pctChange != null && r.pctChange > 10 ? "text-negative font-medium" : ""}`}>{fmtPct(r.pctChange)}</td>
            <td className="text-right">
              {lapsed ? `${r.lastMonth} (${r.monthsSinceLast} mo ago)` : r.nextExpectedMonth}
            </td>
          </tr>
        ))}
      </tbody>
      <Total rows={rows} mep={mep} lapsed={lapsed} />
    </table>
  );
}

function Total({ rows, mep, lapsed }: { rows: RecurringCharge[]; mep: MepTable; lapsed?: boolean }) {
  const { ars, usd, combined } = totals(rows, mep);
  return (
    <tfoot>
      <tr className="border-t-2 border-line font-medium">
        <td className="py-2" colSpan={3}>{lapsed ? "Total, as last billed" : "Total per month"}</td>
        <td className="text-right">{fmtArs(combined)}</td>
        <td className="text-right text-xs text-ink-muted font-normal" colSpan={2}>
          {usd > 0 && `${fmtArs(ars)} + US$ ${usd.toFixed(2)} at MEP`}
        </td>
      </tr>
    </tfoot>
  );
}

export default async function Recurring() {
  const rows = recurringTable(getDb(), loadCpi());
  const mep = loadMep();
  const active = rows.filter(r => r.status === "active");
  const subscriptions = active.filter(r => r.confidence === "high");
  const variable = active.filter(r => r.confidence === "low");
  const lapsed = rows.filter(r => r.status === "lapsed");

  return (
    <main className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-4">Recurring charges</h1>
        <p className="text-sm text-ink-muted mb-4">Nominal amounts — % change vs previous month is the inflation/price-hike signal. A charge qualifies by holding a nominal price (pegged) or by tracking CPI (indexed); a merchant that moved between ARS and USD billing is one row, not two.</p>
        <Table rows={subscriptions} mep={mep} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-1">Frequent, but variable</h2>
        <p className="text-sm text-ink-muted mb-4">Billed most months, but the amount swings too much to be a subscription — supermarkets, fuel, tolls, tips. Listed for completeness; they are budgeted as variable spend, not as fixed obligations.</p>
        <Table rows={variable} mep={mep} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">Lapsed</h2>
        <p className="text-sm text-ink-muted mb-4">Was recurring, has not billed for at least two cycles. No next charge is expected until it reappears.</p>
        <Table rows={lapsed} mep={mep} lapsed />
      </section>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the charges that come back each month. The goal is to show your fixed
        obligations and their price changes. The first table contains the subscriptions. The
        percentage change against the last month is the price signal. A change near inflation is
        normal. A change far above inflation is bad. Examine that merchant, or cancel the
        service. The second table contains frequent charges with variable amounts. They are not
        obligations. The last table contains charges that stopped. No new charge is expected
        from them. A merchant in the wrong table is a signal that its pattern changed.
      </p>
    </main>
  );
}
