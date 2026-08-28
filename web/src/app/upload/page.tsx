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
      <PdfDrop />
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{tr("upload.table.statement")}</th><th>{tr("upload.table.card")}</th>
          <th>{tr("upload.table.cycle")}</th><th>{tr("upload.table.closed")}</th>
          <th className="text-right">{tr("upload.table.transactions")}</th>
          <th className="text-right">{tr("upload.table.alerts")}</th>
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
      <p className="mt-3 text-xs text-ink-muted">{tr("upload.note")}</p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("upload.footer")}</p>
    </main>
  );
}
