import Link from "next/link";
import { getDb } from "@/lib/db";
import { receiptList } from "@/lib/receipts/queries";
import { fmtArsCents } from "@/lib/receipts/money";
import { ReceiptDrop } from "@/components/ReceiptDrop";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

function savedPct(discounts: number, subtotal: number): string {
  if (subtotal === 0) return "—";
  return `${(-discounts * 100 / subtotal).toFixed(1).replace(".", ",")}%`;
}

export default async function Receipts() {
  const rows = receiptList(getDb());
  const tr = await getT();
  return (
    <main>
      <ReceiptDrop />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{tr("receipts.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">{tr("receipts.table.date")}</th><th>{tr("receipts.table.time")}</th>
            <th>{tr("receipts.table.branch")}</th>
            <th className="text-right">{tr("receipts.table.items")}</th>
            <th className="text-right">{tr("receipts.table.subtotal")}</th>
            <th className="text-right">{tr("receipts.table.discounts")}</th>
            <th className="text-right">{tr("receipts.table.total")}</th>
            <th className="text-right">{tr("receipts.table.savings")}</th>
            <th>{tr("receipts.table.source")}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1"><Link href={`/receipts/${r.id}`} className="text-accent underline">{r.date}</Link></td>
                <td>{r.time ?? "—"}</td>
                <td>{r.branch_name ?? "—"}</td>
                <td className="text-right">{r.items}</td>
                <td className="text-right font-mono">{fmtArsCents(r.subtotal_cents)}</td>
                <td className="text-right font-mono">{fmtArsCents(r.discounts_cents)}</td>
                <td className="text-right font-mono">{fmtArsCents(r.total_cents)}</td>
                <td className="text-right">{savedPct(r.discounts_cents, r.subtotal_cents)}</td>
                <td className="text-ink-muted">{tr(r.transcript_source === "ocr" ? "receipts.source.ocr" : "receipts.source.corrected")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{tr("receipts.note")}</p>
      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("receipts.footer")}</p>
    </main>
  );
}
