"use client";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "./I18nProvider";
import { LangToggle } from "./LangToggle";

const links: readonly (readonly [string, MessageKey])[] = [
  ["/", "nav.overview"], ["/trends", "nav.trends"], ["/currency", "nav.currency"], ["/future", "nav.future"],
  ["/installments", "nav.installments"], ["/float", "nav.float"], ["/categories", "nav.categories"],
  ["/merchants", "nav.merchants"], ["/sankey", "nav.sankey"], ["/calendar", "nav.calendar"], ["/habits", "nav.habits"],
  ["/recurring", "nav.recurring"], ["/taxes", "nav.taxes"], ["/credits", "nav.credits"], ["/anomalies", "nav.anomalies"],
  ["/inflation", "nav.inflation"], ["/compare", "nav.compare"], ["/upload", "nav.upload"], ["/review", "nav.review"],
] as const;

export function Nav() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const t = useT();
  const qs = sp.toString();
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1 border-b border-line py-3">
      {links.map(([href, key]) => {
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
            {t(key)}
          </Link>
        );
      })}
      <LangToggle />
    </nav>
  );
}
