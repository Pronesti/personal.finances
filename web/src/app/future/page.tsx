import { getDb } from "@/lib/db";
import { latestMonth, trailingMonthlyInflation } from "@/lib/cpi";
import { cuotaProjection } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { fmtMoney } from "@/lib/format";
import { ModeToggle } from "@/components/ModeToggle";
import { ProjectionChart } from "@/components/ProjectionChart";

export const dynamic = "force-dynamic";

export default async function Future({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = cuotaProjection(getDb(), opts);
  const fmt = (n: number) => fmtMoney(n, modes.value);
  const rate = (trailingMonthlyInflation(opts.cpi) * 100).toFixed(1);
  return (
    <main>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">What you will owe</h1>
        <ModeToggle modes={modes} baseMonth={latestMonth(opts.cpi)} />
      </div>
      <ProjectionChart data={data} value={modes.value} />
      <table className="w-full text-sm mt-6">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">Month</th><th className="text-right">Certain</th>
          <th className="text-right">Expected</th><th className="text-right">Estimated range</th>
        </tr></thead>
        <tbody>
          {data.map(d => (
            <tr key={d.month} className="border-t border-line">
              <td className="py-1">{d.month}</td>
              <td className="text-right">{fmt(d.certain)}</td>
              <td className="text-right">{fmt(d.expected)}</td>
              <td className="text-right">{fmt(d.estLow)} – {fmt(d.estHigh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted mt-3">
        Three layers, three certainties (spec §5). <strong>Certain</strong> is the contractual
        installment schedule from the newest statement of each card. <strong>Expected</strong> is
        your recurring charges — only those still active in the last two cycles — carried forward.
        <strong> Estimated</strong> is the range your variable spending has occupied over the last
        six cycles: a band, not a line, because it is a guess. Nominal figures grow at the trailing
        6-month inflation rate ({rate}%/month); real figures instead deflate the contractual installments
        into today&apos;s pesos.
      </p>
    </main>
  );
}
