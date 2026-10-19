"use client";
import Link from "next/link";
import { useState } from "react";
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
    heading: "nav.group.supermarket",
    links: [
      ["/super", "nav.super"], ["/super/products", "nav.superProducts"], ["/super/categories", "nav.superCategories"],
      ["/receipts", "nav.receipts"], ["/super/charges", "nav.superCharges"], ["/super/review", "nav.superReview"],
    ],
  },
  {
    heading: "nav.group.data",
    links: [["/upload", "nav.upload"], ["/review", "nav.review"]],
  },
] as const;

/** Grouped sidebar on desktop; explicit section menu on smaller screens. */
export function Nav() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const t = useT();
  const qs = sp.toString();
  const [open, setOpen] = useState(false);
  const activeGroup = GROUPS.find(group => group.heading && group.links.some(([href]) => href === pathname))?.heading;
  const [expanded, setExpanded] = useState<{ pathname: string; heading?: MessageKey }>({ pathname, heading: activeGroup });
  if (expanded.pathname !== pathname) {
    setExpanded({ pathname, heading: activeGroup });
  }
  const expandedHeading = expanded.pathname === pathname ? expanded.heading : activeGroup;
  const activeLabel = GROUPS.flatMap(g => g.links).find(([href]) => href === pathname)?.[1] ?? "nav.overview";
  return (
    <nav
      aria-label={t("nav.aria")}
      className="app-nav border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:flex lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 lg:shrink-0 lg:block lg:px-5 lg:pt-6">
        <Link href={qs ? `/?${qs}` : "/"} className="text-lg font-bold tracking-tight">Tarjetas</Link>
        <p className="mt-1 hidden text-xs leading-relaxed text-ink-muted lg:block">{t("nav.subtitle")}</p>
        <button type="button" aria-expanded={open} aria-controls="section-menu" onClick={() => setOpen(!open)} className="min-h-11 rounded-lg border border-line-strong px-3 text-sm lg:hidden">
          {t(activeLabel)} · {t("nav.menu")} <span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
      </div>
      <div id="section-menu" className={`${open ? "block" : "hidden"} px-3 pb-4 lg:block lg:min-h-0 lg:flex-1 lg:overflow-y-auto`}>
        {GROUPS.map((group, gi) => (
          <div key={group.heading ?? gi} className="mb-1">
            {group.heading && (
              <button
                type="button"
                aria-expanded={expandedHeading === group.heading}
                aria-controls={`nav-group-${gi}`}
                onClick={() => setExpanded({ pathname, heading: expandedHeading === group.heading ? undefined : group.heading })}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-surface-2 ${activeGroup === group.heading ? "text-accent" : "text-ink-muted"}`}
              >
                {t(group.heading)}
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-4 w-4 shrink-0 ${expandedHeading === group.heading ? "rotate-180" : ""}`}>
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            )}
            <div id={`nav-group-${gi}`} hidden={!!group.heading && expandedHeading !== group.heading}>
              {group.links.map(([href, key]) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={qs ? `${href}?${qs}` : href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block min-h-11 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
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
          </div>
        ))}
      </div>
      <div className={`${open ? "block" : "hidden"} shrink-0 px-3 pt-2 pb-3 lg:mt-auto lg:block`}>
        <LangToggle />
      </div>
    </nav>
  );
}
