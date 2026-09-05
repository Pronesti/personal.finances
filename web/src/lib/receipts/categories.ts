// Supermarket departments, not the card-charge categories of categorize.ts: a receipt line is
// "dairy" or "produce"; the charge that paid for the whole receipt is "food / supermarket".
export const PRODUCT_CATEGORIES = [
  "produce", "meat_fish", "dairy", "deli", "pantry", "bakery", "prepared", "beverages",
  "cleaning", "personal_care", "pets", "other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(v: unknown): v is ProductCategory {
  return typeof v === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(v);
}
