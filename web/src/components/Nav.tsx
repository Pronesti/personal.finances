"use client";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "./I18nProvider";
import { LangToggle } from "./LangToggle";

type Group = { heading?: MessageKey; links: readonly (readonly [string, MessageKey])[] };

// Twenty-two pages is more than a row of tabs can carry legibly, so they are grouped by the
// question they answer. Overview and Alerts lead ungrouped: they are the two entry points.
const GROUPS: readonly Group[] = [
  { links: [["/", "nav.overview"], ["/anomalies", "nav.anomalies"]] },
  {
    heading: "nav.group.spending",
    links: [
      ["/trends", "nav.trends"], ["/categories", "nav.categories"], ["/merchants", "nav.merchants"],
      ["/movers", "nav.movers"], ["/compare", "nav.compare"], ["/sankey", "nav.sankey"],
    ],
  },
  {
    heading: "nav.group.timing",
    links: [
      ["/calendar", "nav.calendar"], ["/habits", "nav.habits"], ["/pace", "nav.pace"],
      ["/recurring", "nav.recurring"],
    ],
  },
  {
    heading: "nav.group.money",
    links: [
      ["/currency", "nav.currency"], ["/inflation", "nav.inflation"], ["/taxes", "nav.taxes"],
      ["/credits", "nav.credits"], ["/float", "nav.float"],
    ],
  },
  {
    heading: "nav.group.commitments",
    links: [["/future", "nav.future"], ["/installments", "nav.installments"], ["/bank", "nav.bank"]],
  },
  {
    heading: "nav.group.data",
    links: [["/upload", "nav.upload"], ["/review", "nav.review"]],
  },
] as const;

/**
 * Left rail on anything wider than a tablet; a horizontally scrolling strip below that, from the
 * same markup — the group headings simply drop out where there is no column to head. The rail is
 * sticky and scrolls on its own so a long page never strands the navigation above the fold.
 */
export function Nav() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const t = useT();
  const qs = sp.toString();
  return (
    <nav
      aria-label={t("nav.aria")}
      className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-52 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0"
    >
      <div className="flex items-center gap-3 overflow-x-auto px-4 py-2 lg:block lg:overflow-x-visible lg:px-3 lg:py-4">
        <span className="hidden text-sm font-semibold tracking-tight lg:block lg:px-2 lg:pb-3">Tarjetas</span>
        {GROUPS.map((group, gi) => (
          <div key={group.heading ?? gi} className="flex items-center gap-1 lg:mb-4 lg:block">
            {group.heading && (
              <div className="hidden px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle lg:block">
                {t(group.heading)}
              </div>
            )}
            {group.links.map(([href, key]) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={qs ? `${href}?${qs}` : href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-medium transition-colors lg:block ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {t(key)}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="ml-auto lg:ml-0 lg:border-t lg:border-line lg:pt-3">
          <LangToggle />
        </div>
      </div>
    </nav>
  );
}
