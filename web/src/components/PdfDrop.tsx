"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Report = {
  file: string; brand: string; cycle_month: string; transactions: number;
  replaced: string[]; cpi_stale: boolean; alerts: { kind: string; message: string }[];
};
type ApiError = { code: string; message: string; hint?: string };

export function PdfDrop() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [errors, setErrors] = useState<ApiError[]>([]);

  async function send(files: File[]) {
    setBusy(true); setErrors([]); setReports([]);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        // Any throw here — a network drop, a non-JSON body — must still clear `busy`, or the
        // drop zone sits on "Parsing…" forever with an unhandled rejection in the console.
        try {
          const res = await fetch("/api/upload", { method: "POST", body });
          const json = await res.json();
          if (res.ok) setReports(r => [...r, json as Report]);
          else setErrors(e => [...e, json as ApiError]);
        } catch {
          setErrors(e => [...e, { code: "unknown", message: `${file.name}: the server did not answer with a readable result.` }]);
        }
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6">
      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); void send([...e.dataTransfer.files]); }}
        className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors focus-within:border-accent focus-within:text-accent ${
          over
            ? "border-accent bg-accent-soft text-accent"
            : "border-line-strong bg-surface text-ink-muted hover:border-accent hover:text-ink"
        }`}
      >
        <input type="file" accept="application/pdf" multiple className="sr-only"
          onChange={e => { void send([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {busy ? "Parsing…" : "Drop statement PDFs here, or click to choose them"}
      </label>

      {errors.map((err, i) => (
        <div key={i} className="mt-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{err.message}</p>
          {err.hint && <p className="mt-1 text-ink-muted">{err.hint}</p>}
        </div>
      ))}

      {reports.map(report => (
        <div key={report.file} className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p>
            <span className="font-medium">{report.file}</span> — {report.brand}, cycle {report.cycle_month},{" "}
            {report.transactions} transactions.
          </p>
          {report.replaced.length > 0 && (
            <p className="mt-1 text-ink-muted">Replaced: {report.replaced.join(", ")} (nothing was duplicated).</p>
          )}
          {report.cpi_stale && (
            <p className="mt-1 text-warning">
              No CPI data for {report.cycle_month} yet — real-terms views will understate it until you
              run <code className="font-mono">npm run fetch-ipc</code>.
            </p>
          )}
          {report.alerts.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-warning">
              {report.alerts.map((a, i) => <li key={i}>{a.kind}: {a.message}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-ink-muted">Statement math checks out — no integrity alerts.</p>
          )}
        </div>
      ))}
    </div>
  );
}
