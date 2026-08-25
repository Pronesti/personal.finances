import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
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

export type CategoryFile = { rules: Rule[]; proposals: Proposal[]; rejected: string[] };

const FILE = path.join(DATA_DIR, "merchant-categories.json");

export function loadCategoryFile(file: string = FILE): CategoryFile {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CategoryFile>;
  return { rules: raw.rules ?? [], proposals: raw.proposals ?? [], rejected: raw.rejected ?? [] };
}

export function loadRules(): Rule[] {
  return loadCategoryFile().rules;
}

// One entry per line, because the ordering of this file is load-bearing (first match wins) and a
// human reads it. JSON.stringify(…, 2) would explode 32 rules to 160 lines and bury every accept
// in a reformat. Written via a temp file + rename: a half-written file breaks every future ingest.
export function saveCategoryFile(data: CategoryFile, file: string = FILE): void {
  const list = (items: unknown[]) =>
    items.length === 0 ? "[]" : `[\n${items.map(o => `    ${JSON.stringify(o)}`).join(",\n")}\n  ]`;
  const body = [
    "{",
    `  "rules": ${list(data.rules)},`,
    `  "proposals": ${list(data.proposals)},`,
    `  "rejected": ${JSON.stringify(data.rejected)}`,
    "}",
    "",
  ].join("\n");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
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

// Uses categorize itself rather than a second matcher: three implementations of "does this rule
// claim this merchant" (here, categorize, and recategorize's SQL) would drift independently.
export function pendingMerchants(data: CategoryFile, unknown: string[]): string[] {
  const proposed = new Set(data.proposals.map(p => p.merchant));
  const rejected = new Set(data.rejected);
  return unknown.filter(m =>
    categorize(m, "purchases", data.rules).category === "other" &&
    !proposed.has(m) && !rejected.has(m));
}

// Appending puts the new rule last — the lowest priority in a first-match-wins file. Safe by
// construction: a merchant only gets a proposal because no existing rule matched it. A match an
// existing rule already claims is dropped, never overwritten (spec §7) — and `added: false` tells
// the caller not to rewrite the database either.
export function acceptProposal(
  data: CategoryFile, merchant: string, rule: Rule
): { data: CategoryFile; added: boolean } {
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

export function rejectProposal(data: CategoryFile, merchant: string): CategoryFile {
  return {
    rules: data.rules,
    proposals: data.proposals.filter(p => p.merchant !== merchant),
    rejected: data.rejected.includes(merchant) ? data.rejected : [...data.rejected, merchant],
  };
}
