import { AccountingError, type Account, type Currency } from "./model";
import { translator, DICTIONARIES, type Locale, type MessageKey } from "@/lib/i18n";

export type AccountGroup = { id: string; customName: string | null; labelKey: string | null; accountIds: string[]; additive: boolean };
const definitions: Account[] = [
  {"id":"asset","parentId":null,"type":"asset","labelKey":"accounting.account.asset","customName":null,"currency":null,"primaryPurposeId":null,"posting":false,"enabled":true},
  {"id":"liability","parentId":null,"type":"liability","labelKey":"accounting.account.liability","customName":null,"currency":null,"primaryPurposeId":null,"posting":false,"enabled":true},
  {"id":"equity","parentId":null,"type":"equity","labelKey":"accounting.account.equity","customName":null,"currency":null,"primaryPurposeId":null,"posting":false,"enabled":true},
  {"id":"income","parentId":null,"type":"income","labelKey":"accounting.account.income","customName":null,"currency":null,"primaryPurposeId":null,"posting":false,"enabled":true},
  {"id":"expense","parentId":null,"type":"expense","labelKey":"accounting.account.expense","customName":null,"currency":null,"primaryPurposeId":null,"posting":false,"enabled":true},
  {"id":"equity:opening","parentId":"equity","type":"equity","labelKey":"accounting.account.equity.opening","customName":null,"currency":null,"primaryPurposeId":null,"posting":true,"enabled":true},
  {"id":"expense:unallocated","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.unallocated","customName":null,"currency":null,"primaryPurposeId":null,"posting":true,"enabled":true},
  {"id":"expense:food","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.food","customName":null,"currency":null,"primaryPurposeId":"food","posting":false,"enabled":true},
  {"id":"expense:home","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.home","customName":null,"currency":null,"primaryPurposeId":"home","posting":false,"enabled":true},
  {"id":"expense:transport","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.transport","customName":null,"currency":null,"primaryPurposeId":"transport","posting":false,"enabled":true},
  {"id":"expense:health","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.health","customName":null,"currency":null,"primaryPurposeId":"health","posting":false,"enabled":true},
  {"id":"expense:personal","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.personal","customName":null,"currency":null,"primaryPurposeId":"personal","posting":false,"enabled":true},
  {"id":"expense:entertainment","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.entertainment","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":false,"enabled":true},
  {"id":"expense:digital","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.digital","customName":null,"currency":null,"primaryPurposeId":"digital","posting":false,"enabled":true},
  {"id":"expense:education","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.education","customName":null,"currency":null,"primaryPurposeId":"education","posting":false,"enabled":true},
  {"id":"expense:travel","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.travel","customName":null,"currency":null,"primaryPurposeId":"travel","posting":false,"enabled":true},
  {"id":"expense:pets","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.pets","customName":null,"currency":null,"primaryPurposeId":"pets","posting":false,"enabled":true},
  {"id":"expense:financial","parentId":"expense","type":"expense","labelKey":"accounting.account.expense.financial","customName":null,"currency":null,"primaryPurposeId":"financial","posting":false,"enabled":true},
  {"id":"expense:food:groceries","parentId":"expense:food","type":"expense","labelKey":"accounting.account.expense.food.groceries","customName":null,"currency":null,"primaryPurposeId":"food","posting":false,"enabled":true},
  {"id":"expense:food:meals","parentId":"expense:food","type":"expense","labelKey":"accounting.account.expense.food.meals","customName":null,"currency":null,"primaryPurposeId":"food","posting":false,"enabled":true},
  {"id":"expense:food:groceries:produce","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.produce","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:meat","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.meat","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:dairy","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.dairy","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:bakery","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.bakery","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:pantry","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.pantry","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:drinks","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.drinks","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:groceries:prepared","parentId":"expense:food:groceries","type":"expense","labelKey":"accounting.account.expense.food.groceries.prepared","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:meals:restaurants","parentId":"expense:food:meals","type":"expense","labelKey":"accounting.account.expense.food.meals.restaurants","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:meals:delivery","parentId":"expense:food:meals","type":"expense","labelKey":"accounting.account.expense.food.meals.delivery","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:food:meals:memberships","parentId":"expense:food:meals","type":"expense","labelKey":"accounting.account.expense.food.meals.memberships","customName":null,"currency":null,"primaryPurposeId":"food","posting":true,"enabled":true},
  {"id":"expense:home:gas","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.gas","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:cleaning","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.cleaning","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:paper","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.paper","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:kitchen","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.kitchen","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:bedding","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.bedding","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:furniture","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.furniture","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:appliances","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.appliances","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:repairs","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.repairs","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:home:decor","parentId":"expense:home","type":"expense","labelKey":"accounting.account.expense.home.decor","customName":null,"currency":null,"primaryPurposeId":"home","posting":true,"enabled":true},
  {"id":"expense:transport:fuel","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.fuel","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:tolls","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.tolls","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:parking","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.parking","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:public","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.public","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:taxi","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.taxi","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:maintenance","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.maintenance","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:inspection","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.inspection","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:rental","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.rental","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:transport:insurance","parentId":"expense:transport","type":"expense","labelKey":"accounting.account.expense.transport.insurance","customName":null,"currency":null,"primaryPurposeId":"transport","posting":true,"enabled":true},
  {"id":"expense:health:coverage","parentId":"expense:health","type":"expense","labelKey":"accounting.account.expense.health.coverage","customName":null,"currency":null,"primaryPurposeId":"health","posting":true,"enabled":true},
  {"id":"expense:health:medicines","parentId":"expense:health","type":"expense","labelKey":"accounting.account.expense.health.medicines","customName":null,"currency":null,"primaryPurposeId":"health","posting":true,"enabled":true},
  {"id":"expense:health:vision","parentId":"expense:health","type":"expense","labelKey":"accounting.account.expense.health.vision","customName":null,"currency":null,"primaryPurposeId":"health","posting":true,"enabled":true},
  {"id":"expense:personal:clothing","parentId":"expense:personal","type":"expense","labelKey":"accounting.account.expense.personal.clothing","customName":null,"currency":null,"primaryPurposeId":"personal","posting":true,"enabled":true},
  {"id":"expense:personal:hygiene","parentId":"expense:personal","type":"expense","labelKey":"accounting.account.expense.personal.hygiene","customName":null,"currency":null,"primaryPurposeId":"personal","posting":true,"enabled":true},
  {"id":"expense:entertainment:events","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.events","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:entertainment:cinema","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.cinema","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:entertainment:games","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.games","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:entertainment:streaming","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.streaming","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:entertainment:sports","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.sports","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:entertainment:hobbies","parentId":"expense:entertainment","type":"expense","labelKey":"accounting.account.expense.entertainment.hobbies","customName":null,"currency":null,"primaryPurposeId":"entertainment","posting":true,"enabled":true},
  {"id":"expense:digital:ai","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.ai","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:developer","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.developer","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:creative","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.creative","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:hosting","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.hosting","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:domains","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.domains","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:connectivity","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.connectivity","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:digital:devices","parentId":"expense:digital","type":"expense","labelKey":"accounting.account.expense.digital.devices","customName":null,"currency":null,"primaryPurposeId":"digital","posting":true,"enabled":true},
  {"id":"expense:education:materials","parentId":"expense:education","type":"expense","labelKey":"accounting.account.expense.education.materials","customName":null,"currency":null,"primaryPurposeId":"education","posting":true,"enabled":true},
  {"id":"expense:travel:flights","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.flights","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:travel:accommodation","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.accommodation","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:travel:insurance","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.insurance","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:travel:attractions","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.attractions","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:travel:luggage","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.luggage","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:travel:abroad","parentId":"expense:travel","type":"expense","labelKey":"accounting.account.expense.travel.abroad","customName":null,"currency":null,"primaryPurposeId":"travel","posting":true,"enabled":true},
  {"id":"expense:pets:food","parentId":"expense:pets","type":"expense","labelKey":"accounting.account.expense.pets.food","customName":null,"currency":null,"primaryPurposeId":"pets","posting":true,"enabled":true},
  {"id":"expense:pets:supplies","parentId":"expense:pets","type":"expense","labelKey":"accounting.account.expense.pets.supplies","customName":null,"currency":null,"primaryPurposeId":"pets","posting":true,"enabled":true},
  {"id":"expense:pets:vet","parentId":"expense:pets","type":"expense","labelKey":"accounting.account.expense.pets.vet","customName":null,"currency":null,"primaryPurposeId":"pets","posting":true,"enabled":true},
  {"id":"expense:pets:training","parentId":"expense:pets","type":"expense","labelKey":"accounting.account.expense.pets.training","customName":null,"currency":null,"primaryPurposeId":"pets","posting":true,"enabled":true},
  {"id":"expense:pets:unallocated","parentId":"expense:pets","type":"expense","labelKey":"accounting.account.expense.pets.unallocated","customName":null,"currency":null,"primaryPurposeId":"pets","posting":true,"enabled":true},
  {"id":"expense:financial:interest","parentId":"expense:financial","type":"expense","labelKey":"accounting.account.expense.financial.interest","customName":null,"currency":null,"primaryPurposeId":"financial","posting":true,"enabled":true},
  {"id":"expense:financial:fees","parentId":"expense:financial","type":"expense","labelKey":"accounting.account.expense.financial.fees","customName":null,"currency":null,"primaryPurposeId":"financial","posting":true,"enabled":true},
  {"id":"expense:financial:stamp","parentId":"expense:financial","type":"expense","labelKey":"accounting.account.expense.financial.stamp","customName":null,"currency":null,"primaryPurposeId":"financial","posting":true,"enabled":true},
  {"id":"expense:financial:taxes","parentId":"expense:financial","type":"expense","labelKey":"accounting.account.expense.financial.taxes","customName":null,"currency":null,"primaryPurposeId":"financial","posting":true,"enabled":true},
  {"id":"expense:financial:fines","parentId":"expense:financial","type":"expense","labelKey":"accounting.account.expense.financial.fines","customName":null,"currency":null,"primaryPurposeId":"financial","posting":true,"enabled":true},
];
const purposes: AccountGroup[] = [
  {"id":"food","customName":null,"labelKey":"accounting.group.food","accountIds":["expense:food","expense:food:groceries","expense:food:meals","expense:food:groceries:produce","expense:food:groceries:meat","expense:food:groceries:dairy","expense:food:groceries:bakery","expense:food:groceries:pantry","expense:food:groceries:drinks","expense:food:groceries:prepared","expense:food:meals:restaurants","expense:food:meals:delivery","expense:food:meals:memberships"],"additive":true},
  {"id":"home","customName":null,"labelKey":"accounting.group.home","accountIds":["expense:home","expense:home:gas","expense:home:cleaning","expense:home:paper","expense:home:kitchen","expense:home:bedding","expense:home:furniture","expense:home:appliances","expense:home:repairs","expense:home:decor"],"additive":true},
  {"id":"transport","customName":null,"labelKey":"accounting.group.transport","accountIds":["expense:transport","expense:transport:fuel","expense:transport:tolls","expense:transport:parking","expense:transport:public","expense:transport:taxi","expense:transport:maintenance","expense:transport:inspection","expense:transport:rental","expense:transport:insurance"],"additive":true},
  {"id":"health","customName":null,"labelKey":"accounting.group.health","accountIds":["expense:health","expense:health:coverage","expense:health:medicines","expense:health:vision"],"additive":true},
  {"id":"personal","customName":null,"labelKey":"accounting.group.personal","accountIds":["expense:personal","expense:personal:clothing","expense:personal:hygiene"],"additive":true},
  {"id":"entertainment","customName":null,"labelKey":"accounting.group.entertainment","accountIds":["expense:entertainment","expense:entertainment:events","expense:entertainment:cinema","expense:entertainment:games","expense:entertainment:streaming","expense:entertainment:sports","expense:entertainment:hobbies"],"additive":true},
  {"id":"digital","customName":null,"labelKey":"accounting.group.digital","accountIds":["expense:digital","expense:digital:ai","expense:digital:developer","expense:digital:creative","expense:digital:hosting","expense:digital:domains","expense:digital:connectivity","expense:digital:devices"],"additive":true},
  {"id":"education","customName":null,"labelKey":"accounting.group.education","accountIds":["expense:education","expense:education:materials"],"additive":true},
  {"id":"travel","customName":null,"labelKey":"accounting.group.travel","accountIds":["expense:travel","expense:travel:flights","expense:travel:accommodation","expense:travel:insurance","expense:travel:attractions","expense:travel:luggage","expense:travel:abroad"],"additive":true},
  {"id":"pets","customName":null,"labelKey":"accounting.group.pets","accountIds":["expense:pets","expense:pets:food","expense:pets:supplies","expense:pets:vet","expense:pets:training","expense:pets:unallocated"],"additive":true},
  {"id":"financial","customName":null,"labelKey":"accounting.group.financial","accountIds":["expense:financial","expense:financial:interest","expense:financial:fees","expense:financial:stamp","expense:financial:taxes","expense:financial:fines"],"additive":true},
];
export function baseCatalog(): Account[] {
  return [...structuredClone(definitions), ...(["ARS", "USD"] as Currency[]).map(currency => ({
    id: `clearing:${currency}:unresolved-source`, parentId: "asset", type: "asset" as const,
    labelKey: "accounting.account.clearing", customName: null, currency,
    primaryPurposeId: null, posting: true, enabled: true,
  }))];
}
export function purposeGroups(): AccountGroup[] {
  return structuredClone(purposes);
}
export function cardAccounts(cardId: string, displayName: string): Account[] {
  if (!cardId.trim() || !displayName.trim()) throw new AccountingError("invalid_card_identity");
  const root: Account = { id: `card:${cardId}`, parentId: "liability", type: "liability", labelKey: null, customName: displayName, currency: null, primaryPurposeId: null, posting: false, enabled: true };
  const accounts = [root];
  for (const currency of ["ARS", "USD"] as Currency[]) {
    const native: Account = { ...root, id: `card:${cardId}:${currency}`, parentId: root.id, customName: null, labelKey: `accounting.account.${currency.toLowerCase()}`, currency };
    accounts.push(native);
    for (const role of ["billed", "unbilled"] as const) accounts.push({ ...native, id: `${cardId}:${currency}:${role}`, parentId: native.id, labelKey: `accounting.account.${role}`, posting: true });
  }
  return accounts;
}
export function resolveLabel(value: Pick<Account, "customName" | "labelKey">, locale: Locale): string {
  if (value.customName !== null) {
    if (!value.customName.trim()) throw new AccountingError("invalid_custom_name");
    return value.customName;
  }
  if (value.labelKey === null || !(value.labelKey in DICTIONARIES.en)) throw new AccountingError("missing_account_label");
  return translator(locale)(value.labelKey as MessageKey);
}
export function validateGroup(group: AccountGroup): void {
  if (!group.id.trim() || !group.accountIds.length || new Set(group.accountIds).size !== group.accountIds.length || group.accountIds.some(id => !id.trim())) throw new AccountingError("invalid_group");
  resolveLabel(group, "en");
  if (group.additive && !purposes.some(p => p.id === group.id)) throw new AccountingError("custom_group_not_additive");
}
export function validateCatalog(accounts: Account[]): void {
  const byId = new Map(accounts.map(a => [a.id, a]));
  if (byId.size !== accounts.length) throw new AccountingError("duplicate_account_id");
  for (const account of accounts) {
    if (!account.id.trim()) throw new AccountingError("invalid_account_id");
    resolveLabel(account, "en"); resolveLabel(account, "es");
    const visited = new Set([account.id]);
    let current = account;
    while (current.parentId !== null) {
      if (visited.has(current.parentId)) throw new AccountingError("account_cycle");
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent || parent.type !== account.type || parent.posting) throw new AccountingError("invalid_account_parent");
      current = parent;
    }
  }
}
