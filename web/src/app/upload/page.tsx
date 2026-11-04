import { receiptText } from "@/lib/accounting/receipt-messages";
import Link from "next/link";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { postgresPageGate } from "@/components/accounting-gate";
import { getDb } from "@/lib/db";
import { statementList } from "@/lib/queries";
import { PdfDrop } from "@/components/PdfDrop";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function Upload() {
  const accountingGate = await postgresPageGate("/upload");
  if (accountingGate) return accountingGate;

  const pg=selectedBackend()==="postgres"?await withAccounting(async({reader})=>{
    const snapshot=await reader.inspection();return {cards:snapshot.cards,rows:(snapshot.sources??[]).filter(source=>source.kind==="statement").map(source=>({id:source.id,admission:source.admission,file:String((source.rawPayload as {file?:string}).file??source.documentHash),brand:snapshot.cards.find(card=>card.id===source.cardId)?.displayName??source.cardId??"",month:source.closingDate!.slice(0,7),closing_date:source.closingDate!,transactions:(snapshot.sourceLines??[]).filter(line=>line.revisionId===source.id).length,alerts:(snapshot.reviews??[]).filter(event=>event.subjectId===source.id&&event.state==="open"&&!(snapshot.reviews??[]).some(child=>child.priorDecisionId===event.id)).length}))};
  }):null;
  const rows = pg?pg.rows:statementList(getDb());
  const tr = await getT();
  return (
    <main>
      <p className="mb-6 max-w-[80ch] text-sm leading-relaxed text-ink-muted">{pg?receiptText(tr.locale,"accounting.receipts.statementIntro"):tr("upload.intro")}</p>
      <PdfDrop cards={pg?.cards} />
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
            <tr key={"id" in r?String(r.id):r.file} className="border-t border-line">
              <td className="py-1">{"id" in r?<Link href={`/accounting/evidence/${encodeURIComponent(String(r.id))}`} className="text-accent underline">{r.file}</Link>:r.file}{"admission" in r&&<span className="ml-2 text-xs text-ink-muted">{tr(r.admission==="accepted"?"accounting.source.accepted":r.admission==="rejected"?"accounting.source.rejected":"accounting.source.pending")}</span>}</td><td>{r.brand}</td><td>{r.month}</td><td>{r.closing_date}</td>
              <td className="text-right">{r.transactions}</td>
              <td className="text-right">{r.alerts > 0 ? r.alerts : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-sm text-ink-muted">{tr("upload.empty")}</p>}
      </div>
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">{pg?receiptText(tr.locale,"accounting.receipts.statementRetention"):tr("upload.note")}</p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{pg?receiptText(tr.locale,"accounting.receipts.statementIntro"):tr("upload.footer")}</p>
    </main>
  );
}
