import { TableScroll } from "@/components/TableScroll";
import { PageGuide } from "@/components/PageGuide";
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
      <div className="mb-6">
        <PageGuide summary={tr("future.purpose")} detail={tr("future.footer")} />
      </div>
      <ProjectionChart data={data} value={modes.value} />
      <div className="mt-6"><TableScroll label={tr("future.title")}>
      <table className="w-full min-w-[42rem] text-sm [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{tr("future.table.month")}</th><th className="text-right">{tr("future.table.certain")}</th>
          <th className="text-right">{tr("future.table.expected")}</th><th className="text-right">{tr("future.table.range")}</th>
        </tr></thead>
        <tbody>
          {data.map(d => (
            <tr key={d.month} className="border-t border-line">
              <td className="whitespace-nowrap py-1">{d.month}</td>
              <td className="whitespace-nowrap text-right">{fmt(d.certain)}</td>
              <td className="whitespace-nowrap text-right">{fmt(d.expected)}</td>
              <td className="whitespace-nowrap text-right">{fmt(d.estLow)} – {fmt(d.estHigh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll></div>
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">
        {tr("future.note.lead")} <strong>{tr("future.note.certain")}</strong>{" "}
        {tr("future.note.certain.body")} <strong>{tr("future.note.expected")}</strong>{" "}
        {tr("future.note.expected.body")} <strong>{tr("future.note.estimated")}</strong>{" "}
        {tr("future.note.estimated.body")} {tr("future.note.tail", { rate })}
      </p>
    </main>
  );
}
