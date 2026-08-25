import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { monthlySpendByCategory, categoryDrill, periodComparison, eli5, coverage } from "@/lib/queries";

import type { SpendMode, TaxMode, ValueMode, ValueOpts } from "@/lib/queries";

const cpi = { "2026-06": 100, "2026-07": 110 };
const mep = { "2026-06": 1000, "2026-07": 1100 };
const o = (spend: SpendMode, value: ValueMode, tax: TaxMode = "excl"): ValueOpts =>
  ({ spend, value, tax, cpi, mep });

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
    const r = monthlySpendByCategory(db, o("accrual", "nominal"));
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 400, transport: 500 });
  });

  it("cash sums as billed", () => {
    const r = monthlySpendByCategory(db, o("cash", "nominal"));
    const july = Object.fromEntries(r.filter(x => x.month === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 100, transport: 500 });
  });

  it("real mode deflates June to July pesos", () => {
    const r = monthlySpendByCategory(db, o("cash", "real"));
    expect(r.find(x => x.month === "2026-06" && x.category === "food")!.amount).toBeCloseTo(1100);
  });

  it("drill returns level, groups, and keeps USD-only rows visible with null amount", () => {
    const top = categoryDrill(db, o("cash", "nominal"), {});
    expect(top.level).toBe("category");
    expect(top.groups.find(g => g.key === "food")!.amount).toBe(1800);
    const subs = categoryDrill(db, o("cash", "nominal"), { category: "subscriptions" });
    expect(subs.level).toBe("subcategory");
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]).toMatchObject({ amount: null, usd: 3.73 });
    const merch = categoryDrill(db, o("cash", "nominal"), { category: "food", subcategory: "(none)" });
    expect(merch.level).toBe("merchant");
  });

  it("periodComparison computes real deltas", () => {
    const r = periodComparison(db, o("cash", "real"), "month");
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
    const t = eli5(db, o("cash", "real"));
    expect(t.spentThisMonth).toBeCloseTo(1400);
    expect(t.committedNextMonth).toBe(250);
    expect(t.cuotaMonths).toBe(2);
    expect(t.cuotaTotal).toBe(350);
    expect(t.baseMonth).toBe("2026-07");
    expect(t.alerts).toEqual([]);
    const nom = eli5(db, o("cash", "nominal"));
    expect(nom.sparkline.find(s => s.month === "2026-06")!.amount).toBe(1000);
  });

  it("eli5 throws actionable error on empty DB", () => {
    const empty = openDb(":memory:");
    expect(() => eli5(empty, o("cash", "real"))).toThrow(/npm run ingest/);
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
    const shopping = monthlySpendByCategory(db, o("accrual", "nominal"))
      .filter(r => r.month === "2026-07" && r.category === "shopping")
      .reduce((s, r) => s + r.amount, 0);
    // A: 1000 x 6 = 6000. B: 1000 x (6-4+1) = 3000. Plus the seeded TIENDA 100 x (6-3+1) = 400.
    expect(shopping).toBeCloseTo(9400, 6);
  });
});

import { toMode } from "@/lib/queries";

const monthTotal = (rows: { month: string; amount: number }[], month: string) =>
  rows.filter(r => r.month === month).reduce((s, r) => s + r.amount, 0);

describe("USD value mode", () => {
  it("converts ARS rows at the month's MEP rate", () => {
    const db = openDb(":memory:");
    seed(db);
    const usd = monthTotal(monthlySpendByCategory(db, o("cash", "usd")), "2026-06");
    const nominal = monthTotal(monthlySpendByCategory(db, o("cash", "nominal")), "2026-06");
    expect(usd).toBeCloseTo(nominal / 1000, 6);
  });

  it("counts USD-billed rows at face value — the one place they enter aggregates", () => {
    const db = openDb(":memory:");
    seed(db);
    const subs = (mode: ValueMode) =>
      monthlySpendByCategory(db, o("cash", mode))
        .filter(r => r.month === "2026-07" && r.category === "subscriptions")
        .reduce((s, r) => s + r.amount, 0);
    expect(subs("usd")).toBeCloseTo(3.73, 6);   // the seeded Spotify row, billed in USD
    expect(subs("nominal")).toBe(0);            // rev note 3: never in ARS aggregates
  });
});

describe("tax-inclusive mode", () => {
  it("spreads a statement's taxes pro-rata across its purchases", () => {
    const db = openDb(":memory:");
    seed(db);
    // June holds one statement with a single 1000 ARS purchase; a 100 ARS tax row is +10%.
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'IVA RG 4240 21%', 'IVA RG 4240 21%', 'taxes_fees', NULL, 100, NULL, NULL, NULL)`
    ).run(sid);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1100, 6);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "excl")), "2026-06")).toBeCloseTo(1000, 6);
  });

  it("ignores DEVOLUCION DE SALDOS — a balance transfer, not a tax", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'DEVOLUCION DE SALDOS', 'DEVOLUCION DE SALDOS', 'taxes_fees', NULL, 5000, NULL, NULL, NULL)`
    ).run(sid);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1000, 6);
  });

  it("counts USD purchases in the denominator, since RG 5617 is levied on them", () => {
    const db = openDb(":memory:");
    seed(db);
    // The Visa statement holds 900 ARS of net purchases plus a USD-billed 3.73 (= 4103 ARS at
    // the 1100 July rate). A tax of 10% of that combined 5003 base must lift the Visa rows by
    // 10%, not by 55% — which is what an ARS-only denominator would do.
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'DB.RG 5617 30%', 'DB.RG 5617 30%', 'taxes_fees', NULL, ?, NULL, NULL, NULL)`
    ).run(sid, (900 + 3.73 * 1100) * 0.1);
    // The July cycle also carries the Mastercard statement (YPF 500), which has no tax row.
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "excl")), "2026-07")).toBeCloseTo(1400, 6);
    expect(monthTotal(monthlySpendByCategory(db, o("cash", "nominal", "incl")), "2026-07")).toBeCloseTo(900 * 1.1 + 500, 6);
  });

  it("leaves statements with no tax rows alone", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = (tax: TaxMode) => monthTotal(monthlySpendByCategory(db, o("cash", "nominal", tax)), "2026-07");
    expect(jul("incl")).toBeCloseTo(jul("excl"), 6);
  });
});

describe("toMode", () => {
  it("passes nominal through, deflates real, divides usd", () => {
    expect(toMode(1000, "2026-06", o("cash", "nominal"), "2026-07")).toBe(1000);
    expect(toMode(1000, "2026-06", o("cash", "real"), "2026-07")).toBeCloseTo(1100);
    expect(toMode(1000, "2026-06", o("cash", "usd"), "2026-07")).toBeCloseTo(1);
  });
});
