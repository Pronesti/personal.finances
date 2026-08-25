import type Database from "better-sqlite3";
import { categorize, normalizeMerchant, type Rule } from "@/lib/categorize";
import { applyAlias, type Alias } from "@/lib/aliases";
import { checkStatement, type StatementJson, type Alert } from "@/lib/integrity";

export function cycleMonth(closingDate: string, prevClosingDate: string | null): string {
  const end = new Date(closingDate + "T00:00:00Z").getTime();
  const start = prevClosingDate
    ? new Date(prevClosingDate + "T00:00:00Z").getTime()
    : end - 30 * 86400_000;
  return new Date((start + end) / 2).toISOString().slice(0, 7);
}

export function statementToRows(json: StatementJson, rules: Rule[], aliases: Alias[]) {
  const prev = json.period.previous_closing_date ?? null;
  const statement = {
    file: json.file,
    brand: json.brand,
    closing_date: json.period.closing_date,
    cycle_month: cycleMonth(json.period.closing_date, prev),
    due_date: json.period.due_date ?? null,
    prev_closing_date: prev,
    balance_ars: json.balances?.current_ars ?? null,
    balance_usd: json.balances?.current_usd ?? null,
    minimum_payment_ars: json.balances?.minimum_payment_ars ?? null,
  };
  const transactions = json.transactions.map(t => {
    const merchant = applyAlias(normalizeMerchant(t.description), aliases);
    const { category, subcategory } = categorize(merchant, t.section, rules);
    return {
      section: t.section,
      date: t.date,
      description: t.description,
      merchant,
      category, subcategory,
      ars: t.ars, usd: t.usd,
      installment_number: t.installment_number,
      installment_count: t.installment_count,
    };
  });
  const installments = (json.upcoming_installments ?? [])
    .filter(i => i.amount_ars > 0) // real files carry 0.0 filler rows
    .map(i => ({ month: i.month, amount_ars: i.amount_ars }));
  const alerts: Alert[] = checkStatement(json);
  return { statement, transactions, installments, alerts };
}

export function ingestFile(db: Database.Database, json: StatementJson, rules: Rule[], aliases: Alias[]): void {
  const { statement, transactions, installments, alerts } = statementToRows(json, rules, aliases);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM statements WHERE file = ?").run(statement.file);
    const sid = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars)
       VALUES (@file, @brand, @closing_date, @cycle_month, @due_date, @prev_closing_date, @balance_ars, @balance_usd, @minimum_payment_ars)`
    ).run(statement).lastInsertRowid;
    const insTx = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, @section, @date, @description, @merchant, @category, @subcategory, @ars, @usd, @installment_number, @installment_count)`
    );
    for (const t of transactions) insTx.run(sid, t);
    const insUp = db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, ?, ?)");
    for (const i of installments) insUp.run(sid, i.month, i.amount_ars);
    const insAl = db.prepare("INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?, ?, ?, ?, ?)");
    for (const a of alerts) insAl.run(sid, a.kind, a.message, a.expected, a.actual);
  });
  run();
}
