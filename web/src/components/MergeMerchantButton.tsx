"use client";
import { useEffect, useId, useRef, useState } from "react";
import { mergeMerchantAction } from "@/app/categories/actions";
import { useT } from "./I18nProvider";

/**
 * Id of the one `<datalist>` a page renders for every merge dialog on it. A dialog is mounted
 * only while it is open, so it cannot carry the merchant list itself — 200 drill rows would
 * carry 200 copies of it. A datalist is associated by id across the whole document instead, so
 * the page renders it once and each dialog points at it.
 */
export const MERCHANT_LIST_ID = "merge-merchant-names";

export function MerchantNameList({ names }: { names: string[] }) {
  return (
    <datalist id={MERCHANT_LIST_ID}>
      {names.map(n => <option key={n} value={n} />)}
    </datalist>
  );
}

type Props = {
  /** The name shown today, and the default for both fields: merging is usually a rename. */
  merchant: string;
  /** The statement line this was opened from, when there is one. Absent on /merchants. */
  detail?: string;
};

/**
 * Merges the merchant a row shows into one name. Same shape as RecategorizeButton beside it —
 * mounted only while open, native `<dialog>` for the backdrop and the focus trap — because the
 * two are one row of actions and a modal that behaved differently would read as another control.
 */
export function MergeMerchantButton({ merchant, detail }: Props) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-accent hover:underline">
        {t("merge.action")}
      </button>
      {open && <Dialog merchant={merchant} detail={detail} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ merchant, detail, onClose }: Props & { onClose: () => void }) {
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
          try { await mergeMerchantAction(fd); onClose(); } finally { setBusy(false); }
        }}
        className="p-4 text-left"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t("merge.modal.title", { merchant })}
        </h2>
        {detail && <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>}

        <label className="mt-3 block text-xs text-ink-muted">
          {t("merge.modal.match")}
          <input name="match" defaultValue={merchant} required minLength={3} className={field} />
          <span className="mt-1 block text-xs text-ink-subtle">{t("merge.modal.match.note")}</span>
        </label>

        <label className="mt-3 block text-xs text-ink-muted">
          {t("merge.modal.alias")}
          <input
            name="alias"
            defaultValue={merchant}
            required
            list={MERCHANT_LIST_ID}
            autoComplete="off"
            className={field}
          />
          <span className="mt-1 block text-xs text-ink-subtle">{t("merge.modal.alias.note")}</span>
        </label>

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">{t("merge.modal.note")}</p>

        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {t("merge.modal.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? t("merge.modal.saving") : t("merge.modal.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
