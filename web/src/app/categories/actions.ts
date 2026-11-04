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
  if ((await import("@/lib/backend")).selectedBackend() === "postgres") return;
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
  if ((await import("@/lib/backend")).selectedBackend() === "postgres") return;
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

export async function accountingClassifyAction(_previous: {ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}|null,formData:FormData):Promise<{ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}>{
 const {selectedBackend,POSTGRES_READY_PAGES,withAccounting}=await import("@/lib/backend");
 const {classifyPurchase}=await import("@/lib/accounting/review");
 const {getT}=await import("@/lib/locale");const t=await getT();
 if(selectedBackend()!=="postgres"||!POSTGRES_READY_PAGES.has("/categories"))return {ok:false,code:"accounting_action",message:t("accounting.unavailable.body"),messageKey:"accounting.unavailable.body"};
 try {
  const scope=String(formData.get("scope")??"selected");if(!["selected","future_rule","matching_history"].includes(scope))throw Error("invalid_scope");
  const confirmed:unknown=scope==="matching_history"&&formData.get("confirmHistory")==="yes"?JSON.parse(String(formData.get("confirmedPurchaseIds")??"[]")):[];
  if(!Array.isArray(confirmed)||confirmed.some(v=>typeof v!=="string"))throw Error("invalid_confirmation");
  await withAccounting(async({ledger})=>{
   const accountId=String(formData.get("accountId")??""),account=await ledger.transaction(tx=>tx.account(accountId));if(!account)throw Error("missing_account");
   await classifyPurchase(ledger,{key:String(formData.get("key")??""),cardId:String(formData.get("cardId")??""),purchaseId:String(formData.get("purchaseId")??""),accountId,purposeId:account.primaryPurposeId??"unallocated",scope:scope as "selected"|"future_rule"|"matching_history",match:scope==="selected"?null:String(formData.get("match")??""),confirmedPurchaseIds:confirmed as string[],recordedAt:new Date().toISOString()});
  });
  revalidatePath("/","layout");return {ok:true,code:"accounting_action",message:t("accounting.reports.saved"),messageKey:"accounting.reports.saved"};
 }catch{return {ok:false,code:"accounting_action",message:t("accounting.reports.failed"),messageKey:"accounting.reports.failed"};}
}

export async function accountingMergeAction(_previous:{ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}|null,formData:FormData):Promise<{ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}>{
 const {selectedBackend,POSTGRES_READY_PAGES,withAccounting}=await import("@/lib/backend"),{applyReview}=await import("@/lib/accounting/review"),{getT}=await import("@/lib/locale"),t=await getT();
 if(selectedBackend()!=="postgres"||(!POSTGRES_READY_PAGES.has("/categories")&&!POSTGRES_READY_PAGES.has("/merchants")))return {ok:false,code:"accounting_action",message:t("accounting.unavailable.body"),messageKey:"accounting.unavailable.body"};
 try{if(formData.get("confirmHistory")!=="yes")throw Error("confirmation_required");const ids:unknown=JSON.parse(String(formData.get("confirmedPurchaseIds")??"[]"));if(!Array.isArray(ids)||ids.some(id=>typeof id!=="string"))throw Error("invalid_confirmation");await withAccounting(({ledger})=>applyReview(ledger,{key:String(formData.get("key")??""),subjectId:String(formData.get("merchantId")??""),kind:"merchant_merge",payload:{targetName:String(formData.get("targetName")??""),confirmedPurchaseIds:ids},recordedAt:new Date().toISOString()}));revalidatePath("/","layout");return {ok:true,code:"accounting_action",message:t("accounting.reports.saved"),messageKey:"accounting.reports.saved"};}catch{return {ok:false,code:"accounting_action",message:t("accounting.reports.failed"),messageKey:"accounting.reports.failed"};}
}

export async function accountingSourceClassifyAction(_previous:{ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}|null,form:FormData):Promise<{ok:boolean;code?:string;message:string;messageKey?:import("@/lib/i18n").MessageKey}>{
 const {selectedBackend,POSTGRES_READY_PAGES,withAccounting}=await import("@/lib/backend"),{applyReview}=await import("@/lib/accounting/review"),{getT}=await import("@/lib/locale"),t=await getT();
 if(selectedBackend()!=="postgres"||!POSTGRES_READY_PAGES.has("/categories"))return {ok:false,code:"accounting_action",message:t("accounting.unavailable.body"),messageKey:"accounting.unavailable.body"};
 try{
  const scope=String(form.get("scope")??"selected"),confirmed:unknown=scope==="matching_history"?JSON.parse(String(form.get("confirmedSourceLineIds")??"[]")):[];
  if(!Array.isArray(confirmed)||confirmed.some(id=>typeof id!=="string"))throw Error("invalid_confirmation");
  await withAccounting(async({ledger})=>{
   const accountId=String(form.get("accountId")??""),account=await ledger.transaction(tx=>tx.account(accountId));if(!account)throw Error("missing_account");
   await applyReview(ledger,{key:String(form.get("key")??""),kind:"source_classification",subjectId:String(form.get("sourceLineId")??""),payload:{scope,accountId,purposeId:account.primaryPurposeId??"unallocated",match:String(form.get("match")??""),confirmedSourceLineIds:confirmed,confirmHistory:form.get("confirmHistory")==="yes"},recordedAt:new Date().toISOString()});
  });revalidatePath("/","layout");return {ok:true,code:"accounting_action",message:t("accounting.reports.saved"),messageKey:"accounting.reports.saved"};
 }catch{return {ok:false,code:"accounting_action",message:t("accounting.reports.failed"),messageKey:"accounting.reports.failed"};}
}
