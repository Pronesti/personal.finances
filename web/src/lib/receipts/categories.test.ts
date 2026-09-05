import { describe, it, expect } from "vitest";
import { PRODUCT_CATEGORIES, isProductCategory } from "@/lib/receipts/categories";
import { CHART_THEMES } from "@/lib/colors";
import { DICTIONARIES, LOCALES } from "@/lib/i18n";

describe("product categories", () => {
  it("has the twelve keys of the spec, `other` last", () => {
    expect(PRODUCT_CATEGORIES).toEqual([
      "produce", "meat_fish", "dairy", "deli", "pantry", "bakery", "prepared", "beverages",
      "cleaning", "personal_care", "pets", "other",
    ]);
    expect(isProductCategory("dairy")).toBe(true);
    expect(isProductCategory("food")).toBe(false);
  });

  it("has a colour in both schemes and a label in both locales for every key", () => {
    for (const c of PRODUCT_CATEGORIES) {
      expect(CHART_THEMES.light.productCategory[c]).toMatch(/^#[0-9a-f]{6}$/);
      expect(CHART_THEMES.dark.productCategory[c]).toMatch(/^#[0-9a-f]{6}$/);
      for (const locale of LOCALES) expect(DICTIONARIES[locale][`productCategory.${c}`]).toBeTruthy();
    }
  });

  it("gives every category its own colour", () => {
    const light = Object.values(CHART_THEMES.light.productCategory);
    expect(new Set(light).size).toBe(light.length);
  });
});
