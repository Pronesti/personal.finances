import { getDb } from "@/lib/db";
import { statementList } from "@/lib/queries";
import { PdfDrop } from "@/components/PdfDrop";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function Upload() {
  const rows = statementList(getDb());
  const tr = await getT();
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">{tr("upload.title")}</h1>
      <p className="mb-6 max-w-[80ch] text-sm leading-relaxed text-ink-muted">{tr("upload.intro")}</p>
      <PdfDrop />
      <h2 className="mb-3 text-lg font-semibold">{tr("upload.history", { count: rows.length })}</h2>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4" role="region" aria-label={tr("upload.title")} tabIndex={0}>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th scope="col" className="py-1">{tr("upload.table.statement")}</th><th scope="col">{tr("upload.table.card")}</th>
          <th scope="col">{tr("upload.table.cycle")}</th><th scope="col">{tr("upload.table.closed")}</th>
          <th scope="col" className="text-right">{tr("upload.table.transactions")}</th>
          <th scope="col" className="text-right">{tr("upload.table.alerts")}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.file} className="border-t border-line">
              <td className="py-1">{r.file}</td><td>{r.brand}</td><td>{r.month}</td><td>{r.closing_date}</td>
              <td className="text-right">{r.transactions}</td>
              <td className="text-right">{r.alerts > 0 ? r.alerts : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-sm text-ink-muted">{tr("upload.empty")}</p>}
      </div>
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("upload.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("upload.footer")}</p>
    </main>
  );
}
