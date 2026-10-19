import type { ReactNode } from "react";
import { getT } from "@/lib/locale";

export async function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  const tr = await getT();
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-ink-muted md:hidden">{tr("table.scrollHint")}</p>
      <div role="region" aria-label={label} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-4">
        {children}
      </div>
    </div>
  );
}
