import { describe, it, expect } from "vitest";
import {
  DICTIONARIES, LOCALES, DEFAULT_LOCALE, isLocale,
  translate, translatePlural, translator, type Locale, type MessageKey,
} from "@/lib/i18n";

const keys = (locale: Locale) => Object.keys(DICTIONARIES[locale]).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe("dictionaries", () => {
  it("covers every key in every locale", () => {
    for (const locale of LOCALES) expect(keys(locale)).toEqual(keys(DEFAULT_LOCALE));
  });

  it("has no blank strings", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value.trim(), `${locale}/${key}`).not.toBe("");
      }
    }
  });

  // A translation that drops a placeholder silently loses a number the sentence is about.
  it("uses the same placeholders in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of keys(locale) as MessageKey[]) {
        expect(placeholders(DICTIONARIES[locale][key]), `${locale}/${key}`)
          .toEqual(placeholders(DICTIONARIES[DEFAULT_LOCALE][key]));
      }
    }
  });

  // translatePlural picks `.other` for every count but 1, so a lone `.one` would render the key.
  it("pairs every .one key with a .other", () => {
    for (const locale of LOCALES) {
      for (const key of keys(locale)) {
        if (key.endsWith(".one")) {
          expect(keys(locale), `${locale}/${key}`).toContain(`${key.slice(0, -4)}.other`);
        }
      }
    }
  });
});

describe("translate", () => {
  it("fills placeholders", () => {
    expect(translate("en", "merchants.count.in", { period: "2026-07" })).toBe("in 2026-07");
    expect(translate("es", "merchants.count.in", { period: "2026-07" })).toBe("en 2026-07");
  });

  it("leaves a placeholder alone when no value is given", () => {
    expect(translate("en", "merchants.count.in", {})).toContain("{period}");
  });

  it("picks the plural form by count", () => {
    expect(translatePlural("en", "review.charges", 1)).toBe("1 charge");
    expect(translatePlural("en", "review.charges", 4)).toBe("4 charges");
    expect(translatePlural("es", "review.charges", 1)).toBe("1 cargo");
    expect(translatePlural("es", "review.charges", 4)).toBe("4 cargos");
  });

  it("binds a locale", () => {
    const t = translator("es");
    expect(t.locale).toBe("es");
    expect(t("nav.upload")).toBe("Cargar");
    expect(t.plural("review.charges", 2)).toBe("2 cargos");
  });
});

describe("locale detection", () => {
  it("recognises only known locales", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

});

// WeekdayBars stacks the category series and the purchase-count series in one chart, and its
// tooltip tells them apart by display name. Two series sharing a label would format one wrong.
describe("chart series labels", () => {
  it("never collides with a category label in the same chart", () => {
    const seriesKeys: MessageKey[] = [
      "habits.legend.purchases", "habits.legend.avgTicket", "habits.legend.medianTicket",
    ];
    for (const locale of LOCALES) {
      const categories = Object.entries(DICTIONARIES[locale])
        .filter(([k]) => k.startsWith("category."))
        .map(([, v]) => v);
      for (const key of seriesKeys) {
        expect(categories, `${locale}/${key}`).not.toContain(DICTIONARIES[locale][key]);
      }
    }
  });
});
