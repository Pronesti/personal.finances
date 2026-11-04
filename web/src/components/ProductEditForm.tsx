"use client";

import type { ReactNode } from "react";

export function ProductEditForm({ action, children, className }: {
  action: (form: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  // A successful server action otherwise resets selects to the previous render's defaults.
  return <form action={action} onReset={event => event.preventDefault()} className={className}>{children}</form>;
}
