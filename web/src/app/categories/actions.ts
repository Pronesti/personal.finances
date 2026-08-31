"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { realias, recategorize } from "@/lib/queries";
import { upsertRule, CATEGORIES, type Category } from "@/lib/categorize";
import { loadCategoryData, loadRules, saveCategoryData } from "@/lib/rules";
import { loadAliases, mergeAlias, saveAliases } from "@/lib/aliases";

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

// Merging two merchants into one from the drill table or from /merchants. The alias doubles as
// the display name — one concept, not two — so this both collapses the two names into one thing
// for /categories, /recurring and /merchants and renames the charge everywhere it is shown.
// Nothing is lost: transactions.description still holds the statement line verbatim, so the row
// maps back to the PDF exactly as before.
//
// Storing the alias is only half of it. applyAlias runs at ingest time, so a new alias on its own
// changes nothing about the rows already loaded — realize it over them with realias(), which
// rebuilds each row from its description exactly as `npm run ingest` would.
export async function mergeMerchantAction(formData: FormData): Promise<void> {
  const match = String(formData.get("match") ?? "").trim().toUpperCase();
  const alias = String(formData.get("alias") ?? "").trim().toUpperCase();
  // mergeAlias enforces the same floor and returns the list untouched below it; checking here
  // too keeps a rejected merge from rewriting the table and re-deriving every row for nothing.
  if (match.length < 3 || alias.length === 0) return;
  const db = getDb();
  const aliases = mergeAlias(loadAliases(db), match, alias);
  saveAliases(db, aliases);
  realias(db, loadRules(db), aliases);
  // A merchant name is on nearly every page, and a merge can move a row's category with it, so
  // the whole tree is revalidated rather than the two pages the dialog is opened from.
  revalidatePath("/", "layout");
}
