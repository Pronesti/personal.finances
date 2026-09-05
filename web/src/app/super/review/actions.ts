"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { isProductCategory } from "@/lib/receipts/categories";
import { updateProduct, mergeProducts, moveCode } from "@/lib/receipts/products";
import { rematchAll } from "@/lib/receipts/match";

const isId = (v: FormDataEntryValue | null): boolean => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
};

// Product edits change what every /super page shows and what the receipt detail names, so the
// whole tree is revalidated. Bad input is ignored, as the charge actions do: the form re-renders
// with the row still in the queue, which is the only feedback a wrong select can deserve. The
// library calls can also throw (a duplicate name, an unknown product id): caught the same way,
// so a stale or tampered form never surfaces an error, it just leaves the queue as it was.
export async function saveProductAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "");
  const category = String(formData.get("category") ?? "");
  const unit = String(formData.get("unit") ?? "");
  if (!isId(formData.get("id")) || !name.trim() || !isProductCategory(category) || (unit !== "un" && unit !== "kg")) return;
  try {
    updateProduct(getDb(), id, { name, category, unit, needsReview: false });
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}

export async function mergeProductAction(formData: FormData): Promise<void> {
  const source = Number(formData.get("source"));
  const target = Number(formData.get("target"));
  if (!isId(formData.get("source")) || !isId(formData.get("target")) || source === target) return;
  try {
    mergeProducts(getDb(), source, target);
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}

export async function moveCodeAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  const target = Number(formData.get("target"));
  if (!/^\d{10}$/.test(sku) || !isId(formData.get("target"))) return;
  try {
    moveCode(getDb(), "coto", sku, target);
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}

// Rebuilds every line's product match from the current codes and rules. Used after moving a
// code, or for receipts read before products existed. No input to validate; a matcher bug is
// still swallowed so the page just re-renders with whatever state the transaction left.
export async function rematchAllAction(): Promise<void> {
  try {
    rematchAll(getDb());
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}
