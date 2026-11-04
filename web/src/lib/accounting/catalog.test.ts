import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/lib/i18n";
import { baseCatalog, cardAccounts, purposeGroups, resolveLabel, validateCatalog, validateGroup } from "./catalog";

describe("account catalog and labels", () => {
  it("seeds seven grocery accounts without treating supermarket baskets as all food", () => {
    const catalog = baseCatalog();
    expect(catalog.filter(a => a.parentId === "expense:food:groceries" && a.posting)).toHaveLength(7);
    expect(catalog.find(a => a.id === "expense:unallocated")).toMatchObject({ primaryPurposeId: null, posting: true });
    expect(catalog.find(a => a.id === "expense:home:cleaning")).toMatchObject({ primaryPurposeId: "home" });
    expect(catalog.find(a => a.id === "expense:transport:insurance")).toMatchObject({ primaryPurposeId: "transport" });
    expect(catalog.some(a => /car.payment/.test(a.id))).toBe(false);
  });

  it("validates independent card/currency identities without duplicate clearing accounts", () => {
    const catalog = [...baseCatalog(), ...cardAccounts("a", "Visa"), ...cardAccounts("b", "Visa")];
    expect(() => validateCatalog(catalog)).not.toThrow();
    expect(catalog.filter(a => a.id.startsWith("clearing:"))).toHaveLength(2);
    expect(catalog.find(a => a.id === "a:ARS:billed")).toMatchObject({ currency: "ARS", posting: true });
    expect(catalog.find(a => a.id === "b:USD:unbilled")).toMatchObject({ currency: "USD", posting: true });
  });

  it("keeps complete built-in labels while custom names are literal in both languages", () => {
    for (const account of [...baseCatalog(), ...cardAccounts("a", "Visa")]) {
      if (account.labelKey) {
        expect(DICTIONARIES.en[account.labelKey as keyof typeof DICTIONARIES.en]).toBeTruthy();
        expect(DICTIONARIES.es[account.labelKey as keyof typeof DICTIONARIES.es]).toBeTruthy();
      }
    }
    const account = baseCatalog().find(a => a.id === "expense:home:cleaning")!;
    expect(resolveLabel(account, "en")).not.toBe(resolveLabel(account, "es"));
    expect(resolveLabel({ ...account, customName: "  Mi casa  " }, "en")).toBe("  Mi casa  ");
    expect(resolveLabel({ ...account, customName: "  Mi casa  " }, "es")).toBe("  Mi casa  ");
    expect(() => resolveLabel({ ...account, customName: "   " }, "es")).toThrow("invalid_custom_name");
  });

  it("permits cross-type custom collections but prevents additive overlap claims", () => {
    for (const group of purposeGroups()) expect(() => validateGroup(group)).not.toThrow();
    const custom = { id: "my-home", customName: "Casa", labelKey: null,
      accountIds: ["expense:home:cleaning", "a:ARS:billed"], additive: false };
    expect(() => validateGroup(custom)).not.toThrow();
    expect(() => validateGroup({ ...custom, additive: true })).toThrow("custom_group_not_additive");
    expect(() => validateGroup({ ...custom, accountIds: ["x", "x"] })).toThrow("invalid_group");
  });

  it("rejects hierarchy cycles, posting parents, unknown labels and duplicate identities", () => {
    const account = baseCatalog().find(a => a.id === "expense:home:cleaning")!;
    expect(() => validateCatalog([{ ...account, parentId: account.id }])).toThrow("account_cycle");
    expect(() => validateCatalog([account, account])).toThrow("duplicate_account_id");
    expect(() => resolveLabel({ customName: null, labelKey: "missing.builtin" }, "en")).toThrow("missing_account_label");
    const parent = { ...account, id: "parent", parentId: null, posting: true };
    expect(() => validateCatalog([parent, { ...account, parentId: "parent" }])).toThrow("invalid_account_parent");
  });
});
