import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryLedger } from "./memory";
import { seedActualCatalogCards } from "./catalog-service";
import { renameAccountAction, saveAccountGroupAction } from "@/app/accounting/settings/actions";

const state = vi.hoisted(() => ({ ledger: null as unknown as ReturnType<typeof createMemoryLedger> }));
vi.mock("@/lib/backend", () => ({ withAccounting: async (work: (context: { ledger: typeof state.ledger }) => Promise<unknown>) => work({ ledger: state.ledger }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeEach(async () => { state.ledger = createMemoryLedger(); await seedActualCatalogCards(state.ledger, [{ id: "card-a", displayName: "My card" }]); });

it("renames an account without changing financial entries and refuses blank names", async () => {
  const form = new FormData(); form.set("accountId", "expense:home:cleaning"); form.set("customName", "Mi casa");
  await renameAccountAction(form);
  expect((await state.ledger.transaction(tx => tx.account("expense:home:cleaning")))?.customName).toBe("Mi casa");
  form.set("customName", "   "); await expect(renameAccountAction(form)).rejects.toThrow("invalid_custom_name");
  form.set("restoreBuiltin", "yes"); await renameAccountAction(form);
  expect((await state.ledger.transaction(tx => tx.account("expense:home:cleaning")))?.customName).toBeNull();
  expect(await state.ledger.journals("card-a")).toEqual([]);
});

it("creates an overlapping group across account types and prevents tampering with primary purpose membership", async () => {
  const form = new FormData(); form.set("customName", "My collection"); form.append("accountId", "expense:home:cleaning"); form.append("accountId", "card-a:ARS:billed");
  await saveAccountGroupAction(form);
  const groups = await state.ledger.transaction(tx => tx.catalogGroups());
  expect(groups.find(group => group.customName === "My collection")).toMatchObject({ additive: false, accountIds: ["expense:home:cleaning", "card-a:ARS:billed"] });
  const food = groups.find(group => group.id === "food")!;
  form.set("groupId", "food"); form.set("customName", "Comida");
  await saveAccountGroupAction(form);
  expect((await state.ledger.transaction(tx => tx.catalogGroups())).find(group => group.id === "food")).toMatchObject({ additive: true, customName: "Comida", accountIds: food.accountIds });
});
