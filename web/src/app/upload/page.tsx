import { getDb } from "@/lib/db";
import { statementList } from "@/lib/queries";
import { PdfDrop } from "@/components/PdfDrop";

export const dynamic = "force-dynamic";

export default async function Upload() {
  const rows = statementList(getDb());
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Upload</h1>
      <PdfDrop />
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">Statement</th><th>Card</th><th>Cycle</th><th>Closed</th>
          <th className="text-right">Transactions</th><th className="text-right">Alerts</th>
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
      <p className="mt-3 text-xs text-ink-muted">
        Uploading a statement you already have replaces it — the same cycle never lands twice, whatever
        the file is called, and the superseded PDF is kept in pdfs/.superseded. The PDF is parsed
        locally by scripts/pdf_to_json.py; nothing about it leaves this machine.
      </p>

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        This page receives the PDF statements and shows the statements in the database. Drop a
        PDF file in the zone above. The parser reads the file on this machine. No data goes out
        of this machine. When you load a cycle again, the new file replaces the old file. The
        table shows each statement, its card, its cycle, and its alerts. A cycle that is not in
        the table is a hole in the history. The pages that compare periods are less exact when
        holes exist. Load the missing statements to close the holes.
      </p>
    </main>
  );
}
