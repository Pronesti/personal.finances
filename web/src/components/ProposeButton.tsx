"use client";
import { useActionState } from "react";
import { proposeCategories } from "@/app/review/actions";
import { useT } from "./I18nProvider";

export function ProposeButton({ pending }: { pending: number }) {
  const [message, formAction, busy] = useActionState(proposeCategories, null);
  const t = useT();
  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={busy || pending === 0}
        className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? t("review.propose.busy") : t.plural("review.propose.label", pending)}
      </button>
      {message && <p role="status" className="mt-2 text-sm text-warning">{message}</p>}
    </form>
  );
}
