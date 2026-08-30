import type { Proposal } from "@/lib/llm";

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

// The rules, the pending LLM proposals and the rejected merchants, as one value. Stored in the
// database (see lib/rules.ts) rather than in a file, so a correction is a data change: the file
// this used to live in is tracked by git and every accept dirtied the working tree.
export type CategoryData = { rules: Rule[]; proposals: Proposal[]; rejected: string[] };

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

// Uses categorize itself rather than a second matcher: three implementations of "does this rule
// claim this merchant" (here, categorize, and recategorize's SQL) would drift independently.
export function pendingMerchants(data: CategoryData, unknown: string[]): string[] {
  const proposed = new Set(data.proposals.map(p => p.merchant));
  const rejected = new Set(data.rejected);
  return unknown.filter(m =>
    categorize(m, "purchases", data.rules).category === "other" &&
    !proposed.has(m) && !rejected.has(m));
}

// Appending puts the new rule last — the lowest priority in a first-match-wins list. Safe by
// construction: a merchant only gets a proposal because no existing rule matched it. A match an
// existing rule already claims is dropped, never overwritten (spec §7) — and `added: false` tells
// the caller not to rewrite the database either.
export function acceptProposal(
  data: CategoryData, merchant: string, rule: Rule
): { data: CategoryData; added: boolean } {
  const claimed = data.rules.some(r => r.match.toUpperCase() === rule.match.toUpperCase());
  return {
    added: !claimed,
    data: {
      rules: claimed ? data.rules : [...data.rules, rule],
      proposals: data.proposals.filter(p => p.merchant !== merchant),
      rejected: data.rejected,
    },
  };
}

// A correction made by hand from the categories page, where an accept's rules are backwards: the
// merchant already HAS a category, so an appended rule would lose to whichever rule gave it one.
// The new rule goes FIRST for that reason, and rewriting an existing rule for the same match is
// the point here rather than something to refuse.
export function upsertRule(data: CategoryData, rule: Rule): CategoryData {
  const others = data.rules.filter(r => r.match.toUpperCase() !== rule.match.toUpperCase());
  return { ...data, rules: [rule, ...others] };
}

export function rejectProposal(data: CategoryData, merchant: string): CategoryData {
  return {
    rules: data.rules,
    proposals: data.proposals.filter(p => p.merchant !== merchant),
    rejected: data.rejected.includes(merchant) ? data.rejected : [...data.rejected, merchant],
  };
}
