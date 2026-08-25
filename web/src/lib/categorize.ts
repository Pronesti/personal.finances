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
const USD_TAIL_RE = /\s*\S*USD\s*[\d.,]+$/i; // "USD 3,73" and glued "MT8ZSVB45USD 9,99"
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

export function categorize(
  description: string,
  section: string,
  rules: Rule[]
): { category: Category; subcategory: string | null } {
  if (section === "taxes_and_charges") return { category: "taxes_fees", subcategory: null };
  const m = normalizeMerchant(description);
  for (const r of rules) {
    if (m.includes(r.match.toUpperCase())) {
      return { category: r.category, subcategory: r.subcategory ?? null };
    }
  }
  return { category: "other", subcategory: null };
}
