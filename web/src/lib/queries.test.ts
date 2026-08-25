import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { monthlySpendByCategory, categoryDrill, periodComparison, eli5, coverage } from "@/lib/queries";

const cpi = { "2026-06": 100, "2026-07": 110 };

function seed(db: Database.Database) {
  const ins = db.prepare(
    `INSERT INTO statements (file, brand, closing_date, cycle_month, due_date) VALUES (?, ?, ?, ?, ?)`
  );
  const s1 = ins.run("v_2026_06.json", "visa", "2026-06-26", "2026-06", "2026-07-07").lastInsertRowid;
  const s2 = ins.run("v_2026_07.json", "visa", "2026-07-30", "2026-07", "2026-08-07").lastInsertRowid;
  const s3 = ins.run("m_2026_07.json", "mastercard", "2026-07-30", "2026-07", "2026-08-10").lastInsertRowid;
  const tx = db.prepare(
    `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
     VALUES (?, 'purchases', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  tx.run(s1, "2026-06-10", "COTO", "COTO", "food", null, 1000, null, null, null);
  tx.run(s2, "2026-07-10", "COTO", "COTO", "food", null, 1000, null, null, null);
  tx.run(s2, "2026-07-12", "COTO DEVOL", "COTO", "food", null, -200, null, null, null);
  tx.run(s2, "2026-07-11", "MERPAGO*TIENDA", "TIENDA", "shopping", "electronics", 100, null, 3, 6);
  tx.run(s2, "2026-07-09", "Spotify USD 3,73", "SPOTIFY", "subscriptions", "music", null, 3.73, null, null);
  tx.run(s3, "2026-07-15", "YPF", "YPF", "transport", "fuel", 500, null, null, null);
  const up = db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, ?, ?)");
  up.run(s2, "2026-08", 200); up.run(s2, "2026-09", 100);
  up.run(s3, "2026-08", 50);
}

describe("queries", () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(":memory:"); seed(db); });

  it("accrual counts remaining principal at first-observed cuota, nets refunds, skips USD-only in sums", () => {
    const r = monthlySpendByCategory(db, { spend: "accrual", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 400, transport: 500 });
  });

  it("cash sums as billed", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "nominal", cpi });
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 100, transport: 500 });
  });

  it("real mode deflates June to July pesos", () => {
    const r = monthlySpendByCategory(db, { spend: "cash", value: "real", cpi });
    expect(r.find(x => x.month === "2026-06" && x.category === "food")!.amount).toBeCloseTo(1100);
  });

  it("drill returns level, groups, and keeps USD-only rows visible with null amount", () => {
    const top = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, {});
    expect(top.level).toBe("category");
    expect(top.groups.find(g => g.key === "food")!.amount).toBe(1800);
    const subs = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, { category: "subscriptions" });
    expect(subs.level).toBe("subcategory");
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]).toMatchObject({ amount: null, usd: 3.73 });
    const merch = categoryDrill(db, { spend: "cash", value: "nominal", cpi }, { category: "food", subcategory: "(none)" });
    expect(merch.level).toBe("merchant");
  });

  it("periodComparison computes real deltas", () => {
    const r = periodComparison(db, { spend: "cash", value: "real", cpi }, "month");
    expect(r.map(x => x.period)).toEqual(["2026-06", "2026-07"]);
    expect(r[1].pctVsPrev).toBeCloseTo(((1400 - 1100) / 1100) * 100);
  });

  it("coverage reports brands per month", () => {
    expect(coverage(db)).toEqual([
      { month: "2026-06", brands: ["visa"] },
      { month: "2026-07", brands: ["mastercard", "visa"] },
    ]);
  });

  it("eli5 aggregates cuotas across latest statement per brand and honors modes", () => {
    const t = eli5(db, { spend: "cash", value: "real", cpi });
    expect(t.spentThisMonth).toBeCloseTo(1400);
    expect(t.committedNextMonth).toBe(250);
    expect(t.cuotaMonths).toBe(2);
    expect(t.cuotaTotal).toBe(350);
    expect(t.baseMonth).toBe("2026-07");
    expect(t.alerts).toEqual([]);
    const nom = eli5(db, { spend: "cash", value: "nominal", cpi });
    expect(nom.sparkline.find(s => s.month === "2026-06")!.amount).toBe(1000);
  });

  it("eli5 throws actionable error on empty DB", () => {
    const empty = openDb(":memory:");
    expect(() => eli5(empty, { spend: "cash", value: "real", cpi })).toThrow(/npm run ingest/);
  });
});

describe("cuota series identity", () => {
  it("keys each series by its purchase date — two series, one merchant, one count", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', ?, 'ML', 'MERCADOLIBRE', 'shopping', NULL, 1000, NULL, ?, 6)`
    );
    ins.run(sid, "2026-01-05", 1);  // series A, first cuota observed
    ins.run(sid, "2026-05-20", 4);  // series B, first observed at k=4
    const shopping = monthlySpendByCategory(db, { spend: "accrual", value: "nominal", cpi })
      .filter(r => r.month === "2026-07" && r.category === "shopping")
      .reduce((s, r) => s + r.amount, 0);
    // A: 1000 x 6 = 6000. B: 1000 x (6-4+1) = 3000. Plus the seeded TIENDA 100 x (6-3+1) = 400.
    expect(shopping).toBeCloseTo(9400, 6);
  });
});
