"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { CHROME } from "@/lib/chrome";
import { ALL_PERIOD, type Granularity } from "@/lib/months";
import { granularityLabel, parseGranularity, parseModes, periodsFor, resolvePeriod } from "@/lib/scope";
import { useT } from "./I18nProvider";
import { ModeToggle } from "./ModeToggle";
import { Pills } from "./Pills";

/**
 * The top of every page — title, mode toggles, filter pills — rendered by the root layout and
 * not by the pages. Both rows have reserved heights, and a route with nothing to put in a slot
 * leaves it empty rather than pulling the rest up, so the three land on the same pixel row
 * everywhere. A page cannot move them because a page does not render them.
 *
 * A client component because it is driven entirely by the URL: `useSearchParams` re-renders it
 * on every toggle, which a server layout would not do.
 */
export function PageChrome({ months, latestClosing, baseMonth }: {
  /** Every cycle month on file, oldest first — the period picker's raw material. */
  months: readonly string[];
  /** Newest statement closing date, or null before anything is ingested. */
  latestClosing: string | null;
  /** The month real values are expressed in. The same on every page. */
  baseMonth: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useT();
  const chrome = CHROME[pathname];
  // A route with no row gets no header rather than a crash. chrome.test.ts makes sure no page
  // ends up here by accident.
  if (!chrome) return null;

  const query = Object.fromEntries(sp.entries());
  const g = parseGranularity(query);
  const periods = periodsFor(months, g);
  const period = resolvePeriod(periods, query.period, chrome.period ?? "latest");

  // Every page built its filter links the same way, so the chrome builds them once: changing
  // granularity drops `period`, because a month label is not a valid year; changing period keeps
  // everything. Both preserve whatever else is in the URL, which is how /categories keeps the
  // category you drilled into.
  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) q.delete(key); else q.set(key, value);
    }
    const rest = q.toString();
    return rest ? `${pathname}?${rest}` : pathname;
  };

  return (
    <header className="mb-6">
      {/* min-h, not h: 2rem clears both the 1.75rem title line box and the 1.875rem toggle box,
          and still lets the toggles wrap onto a second line on a phone — where nothing is being
          compared between routes anyway. */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">
          {t(chrome.title, chrome.titleVars?.({ latestClosing, period, t }))}
        </h1>
        {chrome.toggles && (
          <ModeToggle
            modes={parseModes(query)}
            baseMonth={baseMonth}
            spendToggle={chrome.toggles.spend !== false}
            taxToggle={chrome.toggles.tax !== false}
          />
        )}
        {chrome.basisCaption && (
          <span className="text-xs text-ink-subtle">{t("mode.inPesos", { month: baseMonth })}</span>
        )}
      </div>
      {/* One line, always. It scrolls sideways rather than wrapping: a period row is as long as
          the statement history, and a second line would push the whole page down. The height is
          fixed rather than fitted so the focus ring has room and an empty row still holds it. */}
      <div className="mt-3 flex h-9 items-center gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chrome.granularities && (
          <Pills
            options={chrome.granularities}
            current={g}
            href={x => href({ g: x, period: undefined })}
            label={x => granularityLabel(x as Granularity, t.locale)}
          />
        )}
        {/* At "all" granularity every month is already one bucket, so the picker would offer
            "all" and nothing else — the granularity pill has said it. */}
        {chrome.period && g !== "all" && (
          <Pills
            options={chrome.period === "all-first" ? [ALL_PERIOD, ...periods] : periods}
            current={period}
            href={p => href({ period: p === ALL_PERIOD ? undefined : p })}
            label={p => (p === ALL_PERIOD ? granularityLabel("all", t.locale) : p)}
          />
        )}
      </div>
    </header>
  );
}
