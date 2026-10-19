"use client";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "./I18nProvider";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function LangToggle() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();

  function choose(next: Locale) {
    if (next === locale) return;
    // A cookie, not a URL segment: every page already carries mode and period state in its query
    // string, and a locale prefix would have to be threaded through all of it.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="relative inline-flex items-center text-ink-muted">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="pointer-events-none absolute left-3 h-4 w-4">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </svg>
      <select
        aria-label={t("lang.label")}
        value={locale}
        onChange={(event) => choose(event.target.value as Locale)}
        className="min-h-11 appearance-none rounded-lg border-0 bg-transparent py-2 pr-8 pl-9 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code} className="bg-surface text-ink">
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="pointer-events-none absolute right-3 h-3 w-3">
        <path d="m5 6 3 3 3-3" />
      </svg>
    </div>
  );
}
