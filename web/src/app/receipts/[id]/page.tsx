import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { receiptDetail } from "@/lib/receipts/queries";
import { fmtArsCents, fmtCents } from "@/lib/receipts/money";
import { ReceiptReport } from "@/components/ReceiptReport";
import { Stat } from "@/components/Stat";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

function qty(milli: number, unit: "un" | "kg"): string {
  return unit === "kg" ? `${(milli / 1000).toFixed(3).replace(".", ",")} kg` : `${milli / 1000}`;
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) notFound();
  const d = receiptDetail(getDb(), n);
  if (!d) notFound();
  const tr = await getT();
  const { receipt, items, report, header, transcript } = d;
  const saved = receipt.subtotal_cents === 0 ? 0 : -receipt.discounts_cents * 100 / receipt.subtotal_cents;

  return (
    <main className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={tr("receipts.stat.total")} value={fmtArsCents(receipt.total_cents)} detail={`${receipt.date} ${receipt.time ?? ""}`} />
        <Stat label={tr("receipts.stat.saved")} value={fmtArsCents(-receipt.discounts_cents)}
          detail={tr("receipts.stat.ofGross", { pct: `${saved.toFixed(1).replace(".", ",")}%` })} />
        <Stat label={tr("receipts.stat.items")} value={items.length} detail={receipt.branch_name ?? ""} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.facts")}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">{tr("receipts.detail.fiscal")}</dt><dd className="font-mono">{receipt.fiscal_number}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.register")}</dt><dd>{receipt.register ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.terminal")}</dt><dd>{receipt.terminal ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.trx")}</dt><dd>{receipt.trx ?? "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.payment")}</dt>
          <dd>{receipt.payment_method ? `${receipt.payment_method} ${receipt.payment_ref ?? ""}` : "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.cae")}</dt>
          <dd className="font-mono">{receipt.cae ? `${receipt.cae} (${receipt.cae_due ?? "—"})` : "—"}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.file")}</dt><dd className="font-mono text-xs">{receipt.file_sha256}</dd>
          <dt className="text-ink-muted">{tr("receipts.detail.scale")}</dt>
          <dd>{receipt.transcript_source === "corrected" ? tr("receipts.source.corrected") : `${receipt.ocr_scale}×`}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.verification")}</h2>
        <ReceiptReport report={report} t={tr} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{tr("receipts.detail.items")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted">
              <th className="py-1">#</th><th>{tr("receipts.items.desc")}</th><th>{tr("receipts.items.code")}</th>
              <th className="text-right">{tr("receipts.items.qty")}</th>
              <th className="text-right">{tr("receipts.items.unitPrice")}</th>
              <th className="text-right">{tr("receipts.items.lineTotal")}</th>
              <th>{tr("receipts.items.discounts")}</th>
              <th className="text-right">{tr("receipts.items.net")}</th>
            </tr></thead>
            <tbody>
              {items.map(it => {
                const discount = it.discounts.reduce((s, x) => s + x.amount_cents, 0);
                return (
                  <tr key={it.id} className="border-t border-line align-top">
                    <td className="py-1 text-ink-muted">{it.position}</td>
                    <td>{it.desc_printed}</td>
                    <td className="font-mono text-xs text-ink-muted">{it.sku ?? "—"}<br />{it.ean ?? ""}</td>
                    <td className="text-right">{qty(it.qty_milli, it.unit)}</td>
                    <td className="text-right font-mono">{it.unit_price_cents === null ? "—" : fmtCents(it.unit_price_cents)}</td>
                    <td className="text-right font-mono">{fmtCents(it.line_total_cents)}</td>
                    <td className="text-xs">
                      {it.discounts.map(x => (
                        <div key={x.id}><span className="text-ink-muted">[{x.tag}]</span> {x.label} <span className="font-mono">{fmtCents(x.amount_cents)}</span></div>
                      ))}
                    </td>
                    <td className="text-right font-mono">{fmtCents(it.line_total_cents + discount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {header.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-ink-muted">{header.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-semibold">{tr("receipts.detail.transcript")}</summary>
        <pre className="mt-2 max-h-[40rem] overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-xs">{transcript}</pre>
      </details>

      <p className="max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("receipts.detail.footer")}</p>
    </main>
  );
}
