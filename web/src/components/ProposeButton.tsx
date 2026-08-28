"use client";
import { useActionState } from "react";
import { proposeCategories } from "@/app/review/actions";

export function ProposeButton({ pending }: { pending: number }) {
  const [message, formAction, busy] = useActionState(proposeCategories, null);
  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={busy || pending === 0}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Asking Claude…" : `Classify ${pending} unknown merchant${pending === 1 ? "" : "s"}`}
      </button>
      {message && <p className="mt-2 text-sm text-warning">{message}</p>}
    </form>
  );
}
