"use client";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";

const links = [
  ["/", "Overview"], ["/trends", "Trends"], ["/currency", "Currency"], ["/future", "Future"], ["/installments", "Installments"], ["/float", "Float"], ["/categories", "Categories"], ["/merchants", "Merchants"], ["/sankey", "Sankey"], ["/calendar", "Calendar"], ["/habits", "Habits"],
  ["/recurring", "Recurring"], ["/taxes", "Taxes"], ["/credits", "Credits"], ["/anomalies", "Alerts"], ["/inflation", "Inflation"], ["/compare", "Compare"], ["/upload", "Upload"], ["/review", "Review"],
] as const;

export function Nav() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const qs = sp.toString();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-line py-3">
      {links.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={qs ? `${href}?${qs}` : href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
