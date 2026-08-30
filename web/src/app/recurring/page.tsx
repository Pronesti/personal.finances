import { getDb } from "@/lib/db";
import { recurringTable } from "@/lib/queries";
import { fmtArs, fmtPct } from "@/lib/format";
import { loadCpi } from "@/lib/cpi";
import { loadMep, mepFor, type MepTable } from "@/lib/mep";
import type { RecurringCharge } from "@/lib/recurring";
import { getT } from "@/lib/locale";
import type { Translator } from "@/lib/i18n";

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

function Table({ rows, mep, lapsed, tr }: { rows: RecurringCharge[]; mep: MepTable; lapsed?: boolean; tr: Translator }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{tr("recurring.none")}</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-line text-left text-ink-muted">
        <th className="py-1">{tr("recurring.table.merchant")}</th><th>{tr("recurring.table.currency")}</th>
        <th className="text-right">{tr("recurring.table.monthsSeen")}</th>
        <th className="text-right">{tr("recurring.table.lastAmount")}</th><th className="text-right">{tr("recurring.table.change")}</th>
        <th className="text-right">{tr(lapsed ? "recurring.table.lastSeen" : "recurring.table.nextExpected")}</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.merchant} className="border-t border-line">
            <td className="py-1">
              {r.merchant}
              {r.currencies.length > 1 && (
                <span className="ml-2 text-xs text-ink-muted">
                  {tr("recurring.billingMoved", {
                    from: r.currencies.filter(c => c !== r.currency)[0], to: r.currency,
                  })}
                </span>
              )}
            </td>
            <td>
              {r.currency}
              {/* Pegged vs indexed is an ARS distinction — it is inflation that forces the
                  choice. In USD both regimes just mean "steady", so the badge would mislead. */}
              {r.currency === "ARS" && r.priceRegime && (
                <span className="ml-2 text-xs text-ink-muted" title={tr(r.priceRegime === "pegged"
                  ? "recurring.regime.pegged.title"
                  : "recurring.regime.indexed.title")}>
                  {tr(r.priceRegime === "pegged" ? "recurring.regime.pegged" : "recurring.regime.indexed")}
                </span>
              )}
            </td>
            <td className="text-right">{r.occurrences}</td>
            <td className="text-right">{amount(r)}</td>
            <td className={`text-right ${r.pctChange != null && r.pctChange > 10 ? "text-negative font-medium" : ""}`}>{fmtPct(r.pctChange)}</td>
            <td className="text-right">
              {lapsed
                ? tr("recurring.lastSeenAgo", { month: r.lastMonth, months: r.monthsSinceLast })
                : r.nextExpectedMonth}
            </td>
          </tr>
        ))}
      </tbody>
      <Total rows={rows} mep={mep} lapsed={lapsed} tr={tr} />
    </table>
  );
}

function Total({ rows, mep, lapsed, tr }: { rows: RecurringCharge[]; mep: MepTable; lapsed?: boolean; tr: Translator }) {
  const { ars, usd, combined } = totals(rows, mep);
  return (
    <tfoot>
      <tr className="border-t-2 border-line font-medium">
        <td className="py-2" colSpan={3}>{tr(lapsed ? "recurring.total.lastBilled" : "recurring.total.perMonth")}</td>
        <td className="text-right">{fmtArs(combined)}</td>
        <td className="text-right text-xs text-ink-muted font-normal" colSpan={2}>
          {usd > 0 && tr("recurring.total.split", { ars: fmtArs(ars), usd: usd.toFixed(2) })}
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
  const tr = await getT();

  return (
    <main className="space-y-8">
      <div>
        <p className="text-sm text-ink-muted mb-4">{tr("recurring.intro")}</p>
        <Table rows={subscriptions} mep={mep} tr={tr} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-1">{tr("recurring.variableHeading")}</h2>
        <p className="text-sm text-ink-muted mb-4">{tr("recurring.variableIntro")}</p>
        <Table rows={variable} mep={mep} tr={tr} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">{tr("recurring.lapsedHeading")}</h2>
        <p className="text-sm text-ink-muted mb-4">{tr("recurring.lapsedIntro")}</p>
        <Table rows={lapsed} mep={mep} lapsed tr={tr} />
      </section>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("recurring.footer")}</p>
    </main>
  );
}
