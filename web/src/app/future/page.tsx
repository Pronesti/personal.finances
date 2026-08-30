import { getDb } from "@/lib/db";
import { trailingMonthlyInflation } from "@/lib/cpi";
import { installmentProjection } from "@/lib/queries";
import { parseModes, valueOpts } from "@/lib/params";
import { getT } from "@/lib/locale";
import { fmtMoney } from "@/lib/format";
import { ProjectionChart } from "@/components/ProjectionChart";

export const dynamic = "force-dynamic";

export default async function Future({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const modes = parseModes(await searchParams);
  const opts = valueOpts(modes);
  const data = installmentProjection(getDb(), opts);
  const fmt = (n: number) => fmtMoney(n, modes.value);
  const rate = (trailingMonthlyInflation(opts.cpi) * 100).toFixed(1);
  const tr = await getT();
  return (
    <main>
      <ProjectionChart data={data} value={modes.value} />
      <table className="w-full text-sm mt-6">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{tr("future.table.month")}</th><th className="text-right">{tr("future.table.certain")}</th>
          <th className="text-right">{tr("future.table.expected")}</th><th className="text-right">{tr("future.table.range")}</th>
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
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">
        {tr("future.note.lead")} <strong>{tr("future.note.certain")}</strong>{" "}
        {tr("future.note.certain.body")} <strong>{tr("future.note.expected")}</strong>{" "}
        {tr("future.note.expected.body")} <strong>{tr("future.note.estimated")}</strong>{" "}
        {tr("future.note.estimated.body")} {tr("future.note.tail", { rate })}
      </p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("future.footer")}</p>
    </main>
  );
}
