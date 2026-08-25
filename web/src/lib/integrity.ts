// Shared shape of the pdf_to_json output. Single source of truth — ingest imports it.
export type StatementJson = {
  file: string;
  brand: string;
  period: { closing_date: string; due_date?: string; previous_closing_date?: string | null };
  balances?: { current_ars?: number | null; current_usd?: number | null; minimum_payment_ars?: number | null };
  declared_totals?: { concept: string; block: number | null; ars: number | null; usd: number | null }[];
  upcoming_installments?: { month: string; amount_ars: number }[];
  transactions: {
    section: string;
    block?: number | null;
    date: string | null;
    description: string;
    ars: number | null;
    usd: number | null;
    installment_number: number | null;
    installment_count: number | null;
  }[];
};

export type Alert = {
  kind: "math_mismatch" | "balance_mismatch";
  message: string;
  expected: number;
  actual: number;
};

const TOLERANCE = 1; // pesos

export function checkStatement(json: StatementJson): Alert[] {
  const alerts: Alert[] = [];
  for (const dt of json.declared_totals ?? []) {
    if (dt.concept.startsWith("TOTAL CONSUMOS") && dt.block != null && dt.ars != null) {
      const actual = json.transactions
        .filter(t => t.section === "purchases" && t.block === dt.block)
        .reduce((s, t) => s + (t.ars ?? 0), 0);
      if (Math.abs(actual - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "math_mismatch",
          message: `${json.file} block ${dt.block}: declared ${dt.ars} vs summed ${actual.toFixed(2)}`,
          expected: dt.ars, actual: Math.round(actual * 100) / 100,
        });
      }
    }
    if (dt.concept === "SALDO ACTUAL" && dt.ars != null && json.balances?.current_ars != null) {
      if (Math.abs(json.balances.current_ars - dt.ars) > TOLERANCE) {
        alerts.push({
          kind: "balance_mismatch",
          message: `${json.file}: SALDO ACTUAL ${dt.ars} vs balances.current_ars ${json.balances.current_ars}`,
          expected: dt.ars, actual: json.balances.current_ars,
        });
      }
    }
  }
  return alerts;
}
