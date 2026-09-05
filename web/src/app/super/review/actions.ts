"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { isProductCategory } from "@/lib/receipts/categories";
import { updateProduct, mergeProducts, moveCode } from "@/lib/receipts/products";

// Product edits change what every /super page shows and what the receipt detail names, so the
// whole tree is revalidated. Bad input is ignored, as the charge actions do: the form re-renders
// with the row still in the queue, which is the only feedback a wrong select can deserve.
export async function saveProductAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "");
  const category = String(formData.get("category") ?? "");
  const unit = String(formData.get("unit") ?? "");
  if (!Number.isInteger(id) || !name.trim() || !isProductCategory(category) || (unit !== "un" && unit !== "kg")) return;
  updateProduct(getDb(), id, { name, category, unit, needsReview: false });
  revalidatePath("/", "layout");
}

export async function mergeProductAction(formData: FormData): Promise<void> {
  const source = Number(formData.get("source"));
  const target = Number(formData.get("target"));
  if (!Number.isInteger(source) || !Number.isInteger(target) || source === target) return;
  mergeProducts(getDb(), source, target);
  revalidatePath("/", "layout");
}

export async function moveCodeAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  const target = Number(formData.get("target"));
  if (!/^\d{10}$/.test(sku) || !Number.isInteger(target)) return;
  moveCode(getDb(), "coto", sku, target);
  revalidatePath("/", "layout");
}
