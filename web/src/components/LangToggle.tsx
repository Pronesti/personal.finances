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
    <div
      className="inline-flex overflow-hidden rounded-md border border-line text-xs"
      role="group"
      aria-label={t("lang.label")}
    >
      {LOCALES.map((code, i) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          onClick={() => choose(code)}
          className={`px-2 py-1 transition-colors ${i > 0 ? "border-l border-line" : ""} ${
            code === locale
              ? "bg-accent text-accent-ink font-medium"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
