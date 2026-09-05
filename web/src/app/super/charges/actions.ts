"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { linkReceipt, unlinkReceipt } from "@/lib/receipts/charges";

// Links are shown on this page, on the receipt detail and in the categories drill table, so the
// whole tree is revalidated. Bad input is ignored: the page re-renders unchanged. The library
// call can throw (a taken charge, a stale form) and is caught so the page re-renders unchanged.
export async function linkChargeAction(formData: FormData): Promise<void> {
  const receipt = Number(formData.get("receipt"));
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!Number.isInteger(receipt) || !/^[0-9a-f]{40}$/.test(fingerprint)) return;
  try {
    linkReceipt(getDb(), receipt, fingerprint, "manual");
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}

export async function unlinkChargeAction(formData: FormData): Promise<void> {
  const receipt = Number(formData.get("receipt"));
  if (!Number.isInteger(receipt)) return;
  unlinkReceipt(getDb(), receipt);
  revalidatePath("/", "layout");
}
