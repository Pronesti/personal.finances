"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { uploadFeedback, type UploadFeedback } from "@/lib/upload-feedback";
import { useT } from "./I18nProvider";

type Report = {
  backend?: "postgres"; sourceRevisionId?: string;
  file: string; brand: string; cycle_month: string; transactions: number;
  replaced: string[]; cpi_stale: boolean; alerts: { kind: string; message: string }[];
};
type ApiError = UploadFeedback;

export function PdfDrop({cards}:{cards?:{id:string;displayName:string}[]}={}) {
  const router = useRouter();
  const t = useT();
  const [cardId,setCardId]=useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [errors, setErrors] = useState<ApiError[]>([]);

  async function send(files: File[]) {
    if (busy || files.length === 0) return;
    if(cards && !cardId){setErrors([{code:"missing_card_identity",message:receiptText(t.locale,"accounting.receipts.cardRequired"),receiptKey:"accounting.receipts.cardRequired"}]);return;}
    setBusy(true); setErrors([]); setReports([]);
    try {
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          setErrors(e => [...e, { code: "type", message: t("upload.error.type", { file: file.name }), messageKey: "upload.error.type", messageParams: { file: file.name } }]);
          continue;
        }
        const body = new FormData();
        body.append("file", file);
        if(cards)body.append("cardId",cardId);
        // Any throw here — a network drop, a non-JSON body — must still clear `busy`, or the
        // drop zone sits on "Parsing…" forever with an unhandled rejection in the console.
        try {
          const res = await fetch("/api/upload", { method: "POST", body });
          const json = await res.json();
          if (res.ok) setReports(r => [...r, json as Report]);
          else setErrors(e => [...e, json as ApiError]);
        } catch {
          setErrors(e => [...e, {
            code: "unknown",
            message: t("upload.error.unreadable", { file: file.name }), messageKey: "upload.error.unreadable", messageParams: { file: file.name },
          }]);
        }
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6" aria-busy={busy}>
      {cards && <label className="mb-3 block text-sm">{receiptText(t.locale,"accounting.receipts.card")}<select value={cardId} onChange={e=>setCardId(e.target.value)} disabled={busy} className="ml-3 min-h-11 rounded-md border border-line-strong bg-surface px-3"><option value="">{receiptText(t.locale,"accounting.receipts.chooseCard")}</option>{cards.map(card=><option key={card.id} value={card.id}>{card.displayName}</option>)}</select></label>}
      <label
        onDragOver={e => { e.preventDefault(); if (!busy) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!busy) void send([...e.dataTransfer.files]); }}
        className={`flex min-h-32 p-5 text-center cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors focus-within:border-accent focus-within:text-accent ${
          over
            ? "border-accent bg-accent-soft text-accent"
            : "border-line-strong bg-surface text-ink-muted hover:border-accent hover:text-ink"
        }`}
      >
        <input type="file" accept="application/pdf" multiple disabled={busy} aria-label={t("upload.drop.idle")} className="sr-only"
          onChange={e => { void send([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {busy ? t("upload.drop.busy") : t("upload.drop.idle")}
      </label>

      <div role="alert">
      {errors.map((err, i) => (
        <div key={i} className="mt-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{uploadFeedback(t, err).message}</p>
          {uploadFeedback(t, err).hint && <p className="mt-1 text-ink-muted">{uploadFeedback(t, err).hint}</p>}
        </div>
      ))}

      </div>
      <div role="status" aria-live="polite">
      {busy && <p className="mt-3 text-sm text-ink-muted">{t("upload.drop.busy")}</p>}
      {reports.map(report => (
        <div key={report.file} className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p>
            <span className="font-medium">{report.file}</span> —{" "}
            {t("upload.report.summary", {
              brand: report.brand, month: report.cycle_month, count: report.transactions,
            })}
          </p>
          {report.sourceRevisionId && <Link className="mt-1 block text-accent underline" href={`/accounting/evidence/${encodeURIComponent(report.sourceRevisionId)}`}>{receiptText(t.locale,"accounting.receipts.source")}</Link>}
          {report.replaced.length > 0 && (
            <p className="mt-1 text-ink-muted">
              {t("upload.report.replaced", { files: report.replaced.join(", ") })}
            </p>
          )}
          {report.cpi_stale && (
            <p className="mt-1 text-warning">
              {t("upload.report.cpiStale", { month: report.cycle_month })}{" "}
              <code className="font-mono">npm run fetch-ipc</code>.
            </p>
          )}
          {report.alerts.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-warning">
              {report.alerts.map((a, i) => <li key={i}>{report.backend==="postgres"?receiptText(t.locale,"accounting.receipts.pending"):`${a.kind}: ${a.message}`}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-ink-muted">{t("upload.report.ok")}</p>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
