"use client";
import { useActionState, type ReactNode } from "react";
import { useT } from "./I18nProvider";

export function AccountingCatalogForm({ action, children }: { action: (form: FormData) => Promise<void>; children: ReactNode }) {
  const t = useT();
  const [state, submit, pending] = useActionState(async (_: "saved" | "failed" | null, form: FormData) => {
    try { await action(form); return "saved" as const; }
    catch { return "failed" as const; }
  }, null);
  return <form action={submit} className="space-y-3" aria-busy={pending}>
    <fieldset disabled={pending} className="space-y-3">{children}</fieldset>
    {state && <p role={state === "failed" ? "alert" : "status"}>{t(`accounting.catalog.${state}`)}</p>}
  </form>;
}
