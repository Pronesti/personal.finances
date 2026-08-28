"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { unknownMerchants, recategorize } from "@/lib/queries";
import { classifyMerchants, MAX_BATCH } from "@/lib/llm";
import {
  loadCategoryFile, saveCategoryFile, pendingMerchants, acceptProposal, rejectProposal,
  CATEGORIES, type Category,
} from "@/lib/categorize";
import { Failure } from "@/lib/failure";
import { getT } from "@/lib/locale";

// Returns a message for the UI, or null on silent success. `prev` is useActionState's previous
// state and is ignored — each run starts from the file on disk, not from the last render.
export async function proposeCategories(_prev: string | null): Promise<string | null> {
  const t = await getT();
  try {
    const data = loadCategoryFile();
    const todo = pendingMerchants(data, unknownMerchants(getDb()).map(m => m.merchant));
    if (todo.length === 0) return t("review.action.nothing");
    const batch = todo.slice(0, MAX_BATCH);
    const proposals = await classifyMerchants(batch);
    // Dedup by merchant: re-proposing one that is already pending must not grow the list.
    const kept = data.proposals.filter(p => !proposals.some(n => n.merchant === p.merchant));
    saveCategoryFile({ ...data, proposals: [...kept, ...proposals] });
    revalidatePath("/review");
    return todo.length > batch.length
      ? t("review.action.partial", { done: proposals.length, total: todo.length })
      : null;
  } catch (e) {
    if (e instanceof Failure) {
      const { message, hint } = e.localized(t.locale);
      return hint ? `${message} ${hint}` : message;
    }
    throw e;
  }
}

export async function acceptAction(formData: FormData): Promise<void> {
  const merchant = String(formData.get("merchant") ?? "");
  const match = String(formData.get("match") ?? "").trim().toUpperCase();
  const category = String(formData.get("category") ?? "");
  const subcategory = String(formData.get("subcategory") ?? "").trim();
  // 3 characters is the floor rulePreview enforces too: a 1-2 character substring claims half
  // the dataset and there is no legitimate merchant rule that short.
  if (!merchant || match.length < 3 || !CATEGORIES.includes(category as Category)) return;
  const { data, added } = acceptProposal(loadCategoryFile(), merchant, {
    match, category: category as Category, subcategory: subcategory || undefined,
  });
  saveCategoryFile(data);
  // Only rewrite the DB if the rule actually landed. Otherwise a hand-written rule keeps the file
  // (spec §7) while the database says something else, and the next ingest silently reverts it.
  if (added) recategorize(getDb(), match, category, subcategory || null);
  revalidatePath("/review");
  revalidatePath("/categories");
}

export async function rejectAction(formData: FormData): Promise<void> {
  const merchant = String(formData.get("merchant") ?? "");
  if (!merchant) return;
  saveCategoryFile(rejectProposal(loadCategoryFile(), merchant));
  revalidatePath("/review");
}
