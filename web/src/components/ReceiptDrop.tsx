"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "./I18nProvider";
import { ReceiptReport } from "./ReceiptReport";
import { fmtArsCents } from "@/lib/receipts/money";
import type { VerificationReport } from "@/lib/receipts/verify";

type Stored = { id: number; date: string; totalCents: number; items: number; report: VerificationReport };
type Rejected = { message: string; report: VerificationReport; rowsText: string; sha256: string; scale: number };
type ApiError = { code: string; message: string; hint?: string };
type Outcome =
  | { kind: "stored"; stored: Stored }
  | { kind: "rejected"; rejected: Rejected }
  | { kind: "error"; error: ApiError }
  | null;

export function ReceiptDrop() {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [rowsText, setRowsText] = useState("");

  async function settle(request: Promise<Response>) {
    setBusy(true);
    try {
      const res = await request;
      const json = await res.json();
      if (res.ok) setOutcome({ kind: "stored", stored: json as Stored });
      else if (res.status === 422) {
        setOutcome({ kind: "rejected", rejected: json as Rejected });
        setRowsText((json as Rejected).rowsText);
      } else setOutcome({ kind: "error", error: json as ApiError });
      router.refresh();
    } catch {
      // A network drop or a non-JSON body must still clear `busy`.
      setOutcome({ kind: "error", error: { code: "unknown", message: t("receipts.error.unreadable") } });
    } finally {
      setBusy(false);
    }
  }

  function send(file: File | undefined) {
    if (!file) return;
    setOutcome(null);
    const body = new FormData();
    body.append("file", file);
    void settle(fetch("/api/receipts", { method: "POST", body }));
  }

  function reverify(sha256: string) {
    void settle(fetch("/api/receipts/corrected", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256, rowsText }),
    }));
  }

  return (
    <div className="mb-6">
      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]); }}
        className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors focus-within:border-accent focus-within:text-accent ${
          over ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-muted hover:border-accent hover:text-ink"
        }`}
      >
        <input type="file" accept="application/pdf" className="sr-only" disabled={busy}
          onChange={e => { send(e.target.files?.[0]); e.target.value = ""; }} />
        {busy ? t("receipts.drop.busy") : t("receipts.drop.idle")}
      </label>

      {outcome?.kind === "error" && (
        <div className="mt-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{outcome.error.message}</p>
          {outcome.error.hint && <p className="mt-1 text-ink-muted">{outcome.error.hint}</p>}
        </div>
      )}

      {outcome?.kind === "stored" && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p>
            {t("receipts.stored", {
              date: outcome.stored.date, items: outcome.stored.items, total: fmtArsCents(outcome.stored.totalCents),
            })}{" "}
            <Link href={`/receipts/${outcome.stored.id}`} className="text-accent underline">{t("receipts.open")}</Link>
          </p>
          {outcome.stored.report.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-ink-muted">
              {outcome.stored.report.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {outcome?.kind === "rejected" && (
        <div className="mt-3 space-y-3 rounded-xl border border-negative/40 bg-surface p-3 text-sm">
          <p className="font-medium text-negative">{outcome.rejected.message}</p>
          <ReceiptReport report={outcome.rejected.report} t={t} />
          <p className="text-xs text-ink-muted">{t("receipts.textareaHint")}</p>
          <textarea
            value={rowsText}
            onChange={e => setRowsText(e.target.value)}
            spellCheck={false}
            className="h-96 w-full rounded-md border border-line bg-canvas p-2 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => reverify(outcome.rejected.sha256)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("receipts.drop.busy") : t("receipts.reverify")}
          </button>
        </div>
      )}
    </div>
  );
}
