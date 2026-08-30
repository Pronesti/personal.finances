"use client";
import { useEffect, useId, useRef, useState } from "react";
import { recategorizeAction } from "@/app/categories/actions";
import { CATEGORIES } from "@/lib/categorize";
import { useT } from "./I18nProvider";

export type RecategorizeRow = {
  month: string; date: string | null; description: string; merchant: string;
  category: string; subcategory: string | null;
};

type Props = { row: RecategorizeRow };

/**
 * Per-charge escape hatch from the drill table. The dialog is mounted only while it is open —
 * 200 rows render 200 buttons, not 200 hidden forms — and it is a native <dialog>, so the
 * backdrop and the focus trap come from the browser rather than from state here.
 */
export function RecategorizeButton({ row }: Props) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-accent hover:underline">
        {t("categories.recategorize")}
      </button>
      {open && <Dialog row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ row, onClose }: Props & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const t = useT();

  // showModal() cannot be an attribute — <dialog open> renders inline, without the backdrop or
  // the focus trap that make this a modal. Guarded because StrictMode runs the effect twice on
  // mount and showModal() throws on a dialog that is already open.
  useEffect(() => { const el = ref.current!; if (!el.open) el.showModal(); }, []);

  // Every close route unmounts the dialog rather than calling el.close(): closing the element
  // while React still holds it mounted leaves an invisible dialog the button cannot reopen, since
  // its `open` state never changed. Escape is intercepted for the same reason.
  const field = "mt-0.5 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      // The dialog is only its own hit target outside the padded form, i.e. on the backdrop.
      onClick={e => { if (e.target === ref.current) onClose(); }}
      // It is a DOM child of a table cell and inherits from it: whitespace-normal undoes the
      // cell's nowrap, which otherwise runs the note off the edge on a single line.
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-line bg-surface p-0 text-ink whitespace-normal backdrop:bg-black/50"
    >
      <form
        action={async fd => {
          setBusy(true);
          try { await recategorizeAction(fd); onClose(); } finally { setBusy(false); }
        }}
        className="p-4 text-left"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t("categories.modal.title", { merchant: row.merchant })}
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">{row.date ?? row.month} · {row.description}</p>
        <input type="hidden" name="merchant" value={row.merchant} />

        <label className="mt-3 block text-xs text-ink-muted">
          {t("categories.modal.match")}
          <input name="match" defaultValue={row.merchant} required minLength={3} className={field} />
        </label>

        <div className="mt-3 flex gap-3">
          <label className="min-w-0 flex-1 text-xs text-ink-muted">
            {t("categories.modal.category")}
            <select name="category" defaultValue={row.category} className={field}>
              {CATEGORIES.map(c => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-xs text-ink-muted">
            {t("categories.modal.subcategory")}
            <input name="subcategory" defaultValue={row.subcategory ?? ""} className={field} />
          </label>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">{t("categories.modal.note")}</p>

        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {t("categories.modal.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? t("categories.modal.saving") : t("categories.modal.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
