"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withAccounting } from "@/lib/backend";
import { saveAccountName, saveGroup } from "@/lib/accounting/catalog-service";
import { AccountingError } from "@/lib/accounting/model";

export async function renameAccountAction(form: FormData): Promise<void> {
  const accountId = String(form.get("accountId") ?? "");
  const reset = form.get("restoreBuiltin") === "yes";
  const customName = reset ? null : String(form.get("customName") ?? "");
  if (!accountId || customName !== null && (!customName.trim() || customName.length > 200)) throw new AccountingError("invalid_custom_name");
  await withAccounting(({ ledger }) => saveAccountName(ledger, { key: randomUUID(), accountId, customName, recordedAt: new Date().toISOString() }));
  revalidatePath("/", "layout");
}

export async function saveAccountGroupAction(form: FormData): Promise<void> {
  const customName = String(form.get("customName") ?? "");
  if (!customName.trim() || customName.length > 200) throw new AccountingError("invalid_custom_name");
  const requestedId = String(form.get("groupId") ?? "");
  await withAccounting(async ({ ledger }) => {
    const existing = requestedId ? await ledger.transaction(async tx => (await tx.catalogGroups()).find(group => group.id === requestedId)) : null;
    if (requestedId && !existing) throw new AccountingError("invalid_group");
    // Primary purposes keep their partition. Custom groups can overlap account types.
    const accountIds = existing?.additive ? existing.accountIds : form.getAll("accountId").map(String);
    await saveGroup(ledger, {
      key: randomUUID(), id: existing?.id ?? `custom:${randomUUID()}`, customName,
      labelKey: existing?.labelKey ?? null, additive: existing?.additive ?? false,
      accountIds, recordedAt: new Date().toISOString(),
    });
  });
  revalidatePath("/", "layout");
}
