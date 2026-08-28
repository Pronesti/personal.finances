import { getDb } from "@/lib/db";
import { latestMonth, loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { bankTerms } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney, fmtPct } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { BankChart } from "@/components/BankChart";
import { RateChart } from "@/components/RateChart";

export const dynamic = "force-dynamic";

const REAL_WINDOW = 12; // months the "limit in real terms" tile looks back

export default async function Bank({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const months = bankTerms(db, opts);
  const latest = months.at(-1);

  // The tile is a real-terms judgement regardless of the active value mode — a nominal limit
  // frozen for a year IS the story, and only constant pesos can say so. Per-card limit, not the
  // sum: the sum dips whenever one card's statement is missing, which is a coverage hole, not
  // the bank moving anything.
  const real = bankTerms(db, { spend: "cash", value: "real", tax: "excl", cpi: loadCpi(), mep: loadMep() })
    .filter(m => m.limitCard != null);
  const last = real.at(-1);
  const back = real.at(-1 - REAL_WINDOW) ?? real[0];
  const realLimitPct = last && back && back !== last && back.limitCard! > 0
    ? ((last.limitCard! - back.limitCard!) / back.limitCard!) * 100
    : null;
  const windowMonths = last && back ? real.indexOf(last) - real.indexOf(back) : null;
  const tr = await getT();

  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tr("bank.title")}</h1>
        {/* Spend/tax toggles hidden: limits, balances and rates are statement-header facts —
            no purchase-level accounting view applies to them. */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} taxToggle={false} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.utilization")}</div>
          <div className="text-2xl font-bold">
            {latest?.utilizationPct != null ? `${latest.utilizationPct.toFixed(1).replace(".", ",")}%` : "—"}
          </div>
          <div className="text-sm text-ink-muted">
            {latest?.balance != null && latest?.limit != null
              ? tr("bank.tile.utilization.detail", {
                  balance: fmtMoney(latest.balance, modes.value), limit: fmtMoney(latest.limit, modes.value),
                })
              : tr("bank.tile.none")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.limitReal")}</div>
          <div className="text-2xl font-bold">{fmtPct(realLimitPct)}</div>
          <div className="text-sm text-ink-muted">
            {windowMonths ? tr("bank.tile.limitReal.detail", { months: windowMonths }) : tr("bank.tile.none")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{tr("bank.tile.realTem")}</div>
          <div className="text-2xl font-bold">
            {latest?.realTemPct != null ? tr("bank.tile.realTem.value", { pct: fmtPct(latest.realTemPct) }) : "—"}
          </div>
          <div className="text-sm text-ink-muted">
            {latest?.temPct != null && latest?.inflationPct != null
              ? tr("bank.tile.realTem.detail", {
                  tem: latest.temPct.toFixed(2).replace(".", ","),
                  infl: latest.inflationPct.toFixed(2).replace(".", ","),
                })
              : tr("bank.tile.realTem.stale")}
          </div>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{tr("bank.headroomHeading")}</h2>
      <BankChart data={months} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">{tr("bank.headroomNote")}</p>

      <h2 className="mb-3 text-lg font-semibold">{tr("bank.ratesHeading")}</h2>
      <RateChart data={months} />
      <p className="mt-3 text-xs text-ink-muted">{tr("bank.ratesNote")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("bank.footer")}</p>
    </main>
  );
}
