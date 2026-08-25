import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

export const CATEGORIES = [
  "food", "transport", "subscriptions", "health", "entertainment", "shopping",
  "services", "travel", "education", "taxes_fees", "transfers", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Rule = { match: string; category: Category; subcategory?: string };

const PREFIX_RE = /^(MERPAGO|MERCADOPAGO|DLOCAL|DLO|PAYU|EBANX|\d+)\*/i;
// Trailing "<CUR> 1 234,56" amounts — Argentine statements use spaces as thousands separators,
// and glue the code to a voucher ("MT8ZSVB45USD 9,99"). Without the \s the amount becomes part
// of the merchant name and every occurrence looks like a brand-new merchant.
const USD_TAIL_RE = /\s*\S*(USD|CLP|EUR|BRL|UYU)\s*[\d.,\s]+$/i;
const NUM_TAIL_RE = /\s+(ID:)?\d{6,}(-\d+)*$/i; // voucher/account tails, incl. "ID:000..." (OSDE drift)

export function normalizeMerchant(description: string): string {
  let s = description.trim().replace(PREFIX_RE, "");
  s = s.replace(/[._*]+/g, " ");     // punctuation drift: "HELP_HBOMAX_COM" ~ "HELP.HBOMAX.COM"
  s = s.replace(USD_TAIL_RE, "");
  s = s.replace(NUM_TAIL_RE, "");
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

export function loadRules(): Rule[] {
  const p = path.join(DATA_DIR, "merchant-categories.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).rules as Rule[];
}

// Takes an already normalized + aliased merchant (ingest does both), not a raw description.
export function categorize(
  merchant: string,
  section: string,
  rules: Rule[]
): { category: Category; subcategory: string | null } {
  if (section === "taxes_and_charges") return { category: "taxes_fees", subcategory: null };
  for (const r of rules) {
    if (merchant.includes(r.match.toUpperCase())) {
      return { category: r.category, subcategory: r.subcategory ?? null };
    }
  }
  return { category: "other", subcategory: null };
}
