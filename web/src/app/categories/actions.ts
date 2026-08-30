"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { recategorize } from "@/lib/queries";
import { upsertRule, CATEGORIES, type Category } from "@/lib/categorize";
import { loadCategoryData, saveCategoryData } from "@/lib/rules";

// Correcting a charge's category from the drill table. A single transaction cannot own a category
// of its own: rows are rebuilt from the rules on every ingest and their ids do not survive it
// (re-ingesting a statement cascades its rows away), so the durable unit is the merchant rule —
// which is why this moves the charge and every sibling the rule text claims, together.
export async function recategorizeAction(formData: FormData): Promise<void> {
  const merchant = String(formData.get("merchant") ?? "");
  const match = String(formData.get("match") ?? "").trim().toUpperCase();
  const category = String(formData.get("category") ?? "");
  const subcategory = String(formData.get("subcategory") ?? "").trim();
  // Same 3-character floor as the review accept: a 1-2 character substring claims half the
  // dataset, and no legitimate merchant rule is that short.
  if (match.length < 3 || !CATEGORIES.includes(category as Category)) return;
  const db = getDb();
  const data = upsertRule(loadCategoryData(db), {
    match, category: category as Category, subcategory: subcategory || undefined,
  });
  // The merchant now has a category by hand, so a proposal still waiting on /review for it is a
  // decision that has already been made — leaving it there asks the same question twice.
  saveCategoryData(db, { ...data, proposals: data.proposals.filter(p => p.merchant !== merchant) });
  recategorize(db, match, category, subcategory || null, "all");
  revalidatePath("/categories");
  revalidatePath("/review");
}
