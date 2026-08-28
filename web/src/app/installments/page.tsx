import Link from "next/link";
import { getDb } from "@/lib/db";
import { latestMonth } from "@/lib/cpi";
import { installmentBurden, activePlans } from "@/lib/queries";
import { parseModes, parseGranularity, GRANULARITIES, valueOpts, withModes } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { Pills } from "@/components/Pills";
import { InstallmentBurdenChart } from "@/components/InstallmentBurdenChart";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

export default async function Installments({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const modes = parseModes(sp);
  const g = parseGranularity(sp);
  const opts = valueOpts(modes);
  const db = getDb();
  const burden = installmentBurden(db, opts, g);
  const plans = activePlans(db, opts);
  const latest = burden.at(-1);
  const committed = plans.reduce((s, p) => s + p.remainingTotal, 0);
  return (
    <main>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Installment burden</h1>
        {/* spend toggle hidden: this page is cash by definition — see installmentBurden */}
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} spendToggle={false} />
      </div>

      <Pills options={GRANULARITIES} current={g} href={x => withModes("/installments", modes, { g: x })} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Open plans</div>
          <div className="text-2xl font-bold">{plans.length}</div>
          <div className="text-sm text-ink-muted">on the latest statements</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Still to pay</div>
          <div className="text-2xl font-bold">{fmtMoney(committed, modes.value)}</div>
          <div className="text-sm text-ink-muted">at the current installment amounts</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">Installment share</div>
          <div className="text-2xl font-bold">{latest ? pct(latest.sharePct) : "—"}</div>
          <div className="text-sm text-ink-muted">of the latest {g}&apos;s purchases</div>
        </div>
      </div>

      <InstallmentBurdenChart data={burden} value={modes.value} />
      <p className="mb-8 mt-3 text-xs text-ink-muted">
        Always &ldquo;as billed&rdquo;: each period shows what its statements actually charged, split
        into installment charges (committed by past decisions) and one-off purchases. The line is the
        installment share — the fraction of the period you could not have avoided by spending less.
        For where this is headed, see <Link href={withModes("/future", modes)} className="text-accent hover:underline">Future</Link>.
      </p>

      <h2 className="mb-3 text-lg font-semibold">Open plans</h2>
      {plans.length === 0
        ? <p className="text-sm text-ink-muted">No open installment plans on the latest statements.</p>
        : <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="py-1 pr-3">Merchant</th><th className="pr-3">Card</th>
                <th className="pr-3 text-right">Progress</th><th className="pr-3 text-right">Monthly</th>
                <th className="pr-3 text-right">Months left</th><th className="pr-3 text-right">Still to pay</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-3">
                    <Link href={withModes("/categories", modes, { merchant: p.merchant })} className="text-accent hover:underline">
                      {p.merchant}
                    </Link>
                  </td>
                  <td className="pr-3 text-ink-muted">{p.brand}</td>
                  <td className="pr-3 text-right">{p.paid}/{p.total}</td>
                  <td className="pr-3 text-right">{fmtMoney(p.monthly, modes.value)}</td>
                  <td className="pr-3 text-right">{p.remainingMonths}</td>
                  <td className="pr-3 text-right">{fmtMoney(p.remainingTotal, modes.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      {plans.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          &ldquo;Still to pay&rdquo; assumes the installment stays at its current nominal amount, which
          Argentine plans do — in real terms each later installment is cheaper.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page shows the part of each statement that comes from installment plans. An
        installment plan divides one purchase into monthly payments. These payments are an
        obligation. You cannot stop them when you spend less. The goal of this analysis is to
        show how rigid your statement is. Read each bar to see one period, divided into
        installment charges and one-time purchases. Read the line to see the installment share
        of that period. A low share is good. It shows that you can decrease your costs quickly
        when it is necessary. A high share is bad. It shows that past decisions control a large
        part of your statement. The table shows each open plan and the amount that you must
        still pay.
      </p>
    </main>
  );
}
