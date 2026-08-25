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

import { currencySplit } from "@/lib/queries";

describe("currencySplit", () => {
  it("separates ARS-billed from USD-billed spend, both in the active mode", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = currencySplit(db, o("cash", "usd")).find(r => r.month === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73, 6);  // the seeded Spotify row
    expect(jul.arsBilled).toBeGreaterThan(0);
  });
  it("reports USD-billed spend in pesos when the mode is nominal", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = currencySplit(db, o("cash", "nominal")).find(r => r.month === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73 * 1100, 6);
    expect(jul.arsBilled).toBeCloseTo(1400, 6);  // 1000 - 200 + 100 + 500
  });
  it("leaves months without USD-billed rows at zero", () => {
    const db = openDb(":memory:");
    seed(db);
    expect(currencySplit(db, o("cash", "nominal")).find(r => r.month === "2026-06")!.usdBilled).toBe(0);
  });
});

import { cuotaProjection, latestStatementIds } from "@/lib/queries";

describe("cuotaProjection", () => {
  it("takes the certain layer only from the newest statement per brand", () => {
    const db = openDb(":memory:");
    seed(db);
    // The June Visa statement is superseded by the July one. Its schedule must not be added.
    const june = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-08', 9999)").run(june);

    expect(latestStatementIds(db)).toHaveLength(2); // one visa, one mastercard
    const p = cuotaProjection(db, o("cash", "nominal"), 3);
    expect(p.map(x => x.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(p[0].certain).toBeCloseTo(250, 6); // 200 (visa July) + 50 (mastercard), never 10249
    expect(p[1].certain).toBeCloseTo(100, 6);
    expect(p[2].certain).toBe(0);
  });

  it("returns nothing when no statements are ingested", () => {
    expect(cuotaProjection(openDb(":memory:"), o("cash", "nominal"))).toEqual([]);
  });
});

import { sankeyFlows, dailySpend } from "@/lib/queries";

describe("sankeyFlows", () => {
  it("emits index-valid brand -> category -> merchant links that conserve flow", () => {
    const db = openDb(":memory:");
    seed(db);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    const name = (i: number) => nodes[i].name;
    expect(nodes.map(n => n.name)).toEqual(expect.arrayContaining(["visa", "mastercard", "food", "transport"]));
    for (const l of links) {
      expect(l.source).toBeGreaterThanOrEqual(0);
      expect(l.target).toBeLessThan(nodes.length);
      expect(l.value).toBeGreaterThan(0);
    }
    // Every category conserves flow: what the cards send in equals what merchants take out.
    const inTo = new Map<string, number>();
    const outOf = new Map<string, number>();
    for (const l of links) {
      const src = name(l.source), tgt = name(l.target);
      if (src === "visa" || src === "mastercard") inTo.set(tgt, (inTo.get(tgt) ?? 0) + l.value);
      else outOf.set(src, (outOf.get(src) ?? 0) + l.value);
    }
    for (const [category, into] of inTo) expect(outOf.get(category)).toBeCloseTo(into, 6);
  });

  it("nets refunds at merchant grain, so food is 800 not 1000", () => {
    const db = openDb(":memory:");
    seed(db);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    const food = links.find(l => nodes[l.source].name === "visa" && nodes[l.target].name === "food")!;
    expect(food.value).toBeCloseTo(800, 6);
  });

  it("drops a merchant that nets to zero without unbalancing its category", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', '2026-07-20', 'REFUNDED', 'REFUNDED', 'food', NULL, ?, NULL, NULL, NULL)`
    );
    ins.run(sid, 5000); ins.run(sid, -5000);
    const { nodes, links } = sankeyFlows(db, o("cash", "nominal"), "2026-07");
    expect(nodes.map(n => n.name)).not.toContain("REFUNDED");
    const into = links.filter(l => nodes[l.target].name === "food" && nodes[l.source].name === "visa")
      .reduce((s, l) => s + l.value, 0);
    const outOf = links.filter(l => nodes[l.source].name === "food").reduce((s, l) => s + l.value, 0);
    expect(outOf).toBeCloseTo(into, 6);
  });

  it("returns nothing for a month with no statements", () => {
    const db = openDb(":memory:");
    seed(db);
    expect(sankeyFlows(db, o("cash", "nominal"), "2020-01")).toEqual({ nodes: [], links: [] });
  });
});

describe("dailySpend", () => {
  it("counts a cuota series once at full price, not once per statement", () => {
    const db = openDb(":memory:");
    seed(db);
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       SELECT id, 'purchases', '2026-06-15', 'SOFA', 'SOFA', 'shopping', NULL, 1000, NULL, ?, 6
       FROM statements WHERE file = ?`
    );
    ins.run(1, "v_2026_06.json");
    ins.run(2, "v_2026_07.json");
    // Even though the caller asks for cash mode, a calendar is about purchase days: accrual wins.
    const day = dailySpend(db, o("cash", "nominal")).find(d => d.date === "2026-06-15")!;
    expect(day.amount).toBeCloseTo(6000, 6);
  });

  it("emits one entry per dated day and skips undated rows", () => {
    const db = openDb(":memory:");
    seed(db);
    const days = dailySpend(db, o("cash", "nominal"));
    expect(days.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(new Set(days.map(d => d.date)).size).toBe(days.length);
  });
});

describe("eli5 phase 2 tiles", () => {
  it("forecasts the next statement as three layers", () => {
    const db = openDb(":memory:");
    seed(db);
    const t = eli5(db, o("cash", "nominal"));
    expect(t.nextStatementForecast.certain).toBeCloseTo(250, 6); // newest statement per brand
    expect(t.nextStatementForecast.estHigh).toBeGreaterThanOrEqual(t.nextStatementForecast.estLow);
  });

  it("surfaces unresolved anomalies and hides the ones the statement already reversed", () => {
    const db = openDb(":memory:");
    seed(db);
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       SELECT id, 'purchases', '2026-07-14', 'ACME', 'ACME', 'shopping', NULL, ?, NULL, NULL, NULL
       FROM statements WHERE file = 'v_2026_07.json'`
    );
    ins.run(90000); ins.run(90000);                  // open duplicate
    ins.run(80000); ins.run(80000); ins.run(-80000); // duplicate the bank already reversed
    const t = eli5(db, o("cash", "nominal"));
    expect(t.openAnomalies.every(a => !a.resolved)).toBe(true);
    const dupes = t.openAnomalies.filter(a => a.kind === "duplicate");
    expect(dupes.map(a => a.amount)).toEqual([90000]);
  });
});
