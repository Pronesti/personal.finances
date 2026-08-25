import type { StatementJson } from "@/lib/integrity";
import type { Rule } from "@/lib/categorize";
import type { Alias } from "@/lib/aliases";

export const rules: Rule[] = [{ match: "OSDE", category: "health", subcategory: "insurance" }];
export const aliases: Alias[] = [{ match: "OSDE", alias: "OSDE" }];

export const fixture = {
  file: "visa_2026_07_30.pdf",
  brand: "visa",
  period: { closing_date: "2026-07-30", due_date: "2026-08-07", previous_closing_date: "2026-07-02" },
  balances: { current_ars: 100120, current_usd: 32.32, minimum_payment_ars: 280310.0 },
  declared_totals: [
    { concept: "TOTAL CONSUMOS DE JUAN PEREZ", block: 1, ars: 100120, usd: 6.99 },
    { concept: "SALDO ACTUAL", block: null, ars: 100120, usd: null },
  ],
  upcoming_installments: [
    { month: "2026-08", amount_ars: 375290.39 },
    { month: "2026-09", amount_ars: 0.0 },
  ],
  transactions: [
    { section: "payments", block: null, date: "2026-07-13", description: "SU PAGO EN PESOS", ars: -3864892.39, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-10", description: "OSDE 000012345678901", ars: 120000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-12", description: "OSDE 000012345678901", ars: -70000, usd: null, installment_number: null, installment_count: null },
    { section: "purchases", block: 1, date: "2026-07-11", description: "MERPAGO*TIENDANEWSAN", ars: 50120, usd: null, installment_number: 13, installment_count: 18 },
    { section: "purchases", block: 1, date: "2026-07-09", description: "APPLE.COM/BILL MT8XM2T22USD 6,99", ars: null, usd: 6.99, installment_number: null, installment_count: null },
    { section: "taxes_and_charges", block: null, date: null, description: "IVA RG 4240 21%( 37759,04)", ars: 7929.39, usd: null, installment_number: null, installment_count: null },
  ],
} satisfies StatementJson;
