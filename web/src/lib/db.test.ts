import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";

describe("db", () => {
  it("creates schema and accepts rows", () => {
    const db = openDb(":memory:");
    const s = db.prepare(
      `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date, prev_closing_date, balance_ars, balance_usd, minimum_payment_ars)
       VALUES ('visa_x.json','visa','2026-07-30','2026-07','2026-08-07','2026-07-02',100,1,10)`
    ).run();
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', '2026-07-10', 'MERPAGO*X', 'X', 'other', NULL, 50, NULL, 1, 6)`
    ).run(s.lastInsertRowid);
    db.prepare(`INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-08', 375290.39)`)
      .run(s.lastInsertRowid);
    db.prepare(`INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?, 'math_mismatch', 'x', 100, 95)`)
      .run(s.lastInsertRowid);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 1 });
  });

  it("statement file unique; upcoming PK rejects dup month per statement", () => {
    const db = openDb(":memory:");
    const ins = db.prepare(`INSERT INTO statements (file, brand, closing_date, cycle_month) VALUES ('a.json','visa','2026-01-29','2026-01')`);
    const sid = ins.run().lastInsertRowid;
    expect(() => ins.run()).toThrow();
    const up = db.prepare(`INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-02', 1)`);
    up.run(sid);
    expect(() => up.run(sid)).toThrow();
  });
});
