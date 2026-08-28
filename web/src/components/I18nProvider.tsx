"use client";
import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translator, type Locale, type Translator } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Seeded by the root layout from the request cookie, so client and server agree on first paint. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
