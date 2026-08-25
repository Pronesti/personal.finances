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
        className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
      >
        {busy ? "Asking Claude…" : `Classify ${pending} unknown merchant${pending === 1 ? "" : "s"}`}
      </button>
      {message && <p className="mt-2 text-sm text-amber-700 dark:text-amber-500">{message}</p>}
    </form>
  );
}
