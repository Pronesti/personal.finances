import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, translator, type Locale, type Translator } from "@/lib/i18n";

// Server-only: `cookies()` is request-scoped. Client components read the locale from
// I18nProvider instead, which the root layout seeds with exactly this value.

/**
 * English until the reader picks otherwise. Deliberately NOT negotiated from Accept-Language:
 * this is an Argentine app read in Spanish-locale browsers, and header sniffing would make
 * Spanish the de facto default for exactly the readers who asked for an English one.
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(chosen) ? chosen : DEFAULT_LOCALE;
}

/** What a page actually wants: one bound `t` for the request. */
export async function getT(): Promise<Translator> {
  return translator(await getLocale());
}
