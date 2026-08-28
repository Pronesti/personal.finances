import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { spendByCategory, periodTotals, categoryDrill, periodComparison, eli5, coverage, statementList, reviewableAlerts, setAlertReview, staleReviews, unknownMerchants, rulePreview, recategorize, merchantEvidence, merchantConcentration, merchantNovelty, installmentBurden, activePlans, taxBurden } from "@/lib/queries";

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

  it("reviewableAlerts merges integrity alerts and anomalies, all open by default", () => {
    const sid = db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number };
    db.prepare("INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?,?,?,?,?)")
      .run(sid.id, "math_mismatch", "v_2026_07.json block 1: declared 10 vs summed 20.00", 10, 20);
    const rows = reviewableAlerts(db, cpi);
    const integrity = rows.filter(r => r.source === "integrity");
    expect(integrity).toHaveLength(1);
    expect(integrity[0]).toMatchObject({ kind: "math_mismatch", state: "open", month: "2026-07" });
    // Identity, not prose: no filename, no cents.
    expect(integrity[0].key).toBe("integrity|visa|2026-07-30|math_mismatch|10");
  });

  it("keeps a dismissal when the statement is re-ingested under a new filename", () => {
    const sid = db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number };
    db.prepare("INSERT INTO alerts (statement_id, kind, message, expected, actual) VALUES (?,?,?,?,?)")
      .run(sid.id, "math_mismatch", "v_2026_07.json block 1: declared 10 vs summed 20.00", 10, 20);
    const key = reviewableAlerts(db, cpi).find(r => r.source === "integrity")!.key;
    setAlertReview(db, key, "dismissed");
    // Same cycle, different filename and one cent of drift in the message.
    db.prepare("UPDATE statements SET file = 'visa_july.json' WHERE id = ?").run(sid.id);
    db.prepare("UPDATE alerts SET message = 'visa_july.json block 1: declared 10 vs summed 20.01' WHERE statement_id = ?").run(sid.id);
    expect(reviewableAlerts(db, cpi).find(r => r.key === key)!.state).toBe("dismissed");
  });

  it("stores an explicit reopen so it beats a computed default", () => {
    setAlertReview(db, "anomaly|duplicate|X|2026-07|2026-07-01|100", "open");
    expect(db.prepare("SELECT state FROM alert_reviews WHERE key = ?")
      .get("anomaly|duplicate|X|2026-07|2026-07-01|100")).toEqual({ state: "open" });
  });

  it("staleReviews clears reviews no live alert claims", () => {
    setAlertReview(db, "anomaly|duplicate|GONE|2020-01|2020-01-01|1", "dismissed");
    expect(staleReviews(db, reviewableAlerts(db, cpi))).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM alert_reviews").get()).toEqual({ n: 0 });
  });

  it("categoryDrill narrows to a single merchant", () => {
    const { rows } = categoryDrill(db, o("cash", "nominal"), { merchant: "COTO" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.merchant === "COTO")).toBe(true);
  });

  it("unknownMerchants lists uncategorized purchase merchants, biggest spender first, netting refunds", () => {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'purchases','2026-07-20','DIA','DIA','other',NULL,3000,NULL,NULL,NULL),
                       (2,'purchases','2026-07-21','DIA DEVOL','DIA','other',NULL,-1000,NULL,NULL,NULL),
                       (2,'purchases','2026-07-22','SOMMIERLANDIA','SOMMIERLANDIA','other',NULL,5000,NULL,NULL,NULL)`).run();
    const rows = unknownMerchants(db);
    expect(rows.map(r => r.merchant)).toEqual(["SOMMIERLANDIA", "DIA"]);
    expect(rows.find(r => r.merchant === "DIA")!.total).toBe(2000); // 3000 - 1000, not 4000
  });

  it("rulePreview shows every other merchant a substring rule would also claim", () => {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'purchases','2026-07-20','DIA','DIA','other',NULL,3000,NULL,NULL,NULL),
                       (2,'purchases','2026-07-22','SOMMIERLANDIA','SOMMIERLANDIA','other',NULL,5000,NULL,NULL,NULL)`).run();
    expect(rulePreview(db, "DIA").map(r => r.merchant)).toEqual(["DIA", "SOMMIERLANDIA"]);
  });

  it("merchantEvidence summarizes a merchant's history with raw lines, newest first", () => {
    const ev = merchantEvidence(db, "COTO")!;
    expect(ev).toMatchObject({ count: 3, firstMonth: "2026-06", lastMonth: "2026-07", brands: ["visa"] });
    expect(ev.sample.map(s => s.date)).toEqual(["2026-07-12", "2026-07-10", "2026-06-10"]);
    expect(ev.sample[0].description).toBe("COTO DEVOL");
    expect(merchantEvidence(db, "NUNCA VISTO")).toBeNull();
  });

  it("merchantEvidence caps the sample but reports the full count", () => {
    const ev = merchantEvidence(db, "COTO", 2)!;
    expect(ev.count).toBe(3);
    expect(ev.sample).toHaveLength(2);
  });

  it("merchantConcentration ranks merchants with cumulative share, netting refunds", () => {
    const { merchants, totalSpend } = merchantConcentration(db, o("cash", "nominal"));
    expect(totalSpend).toBe(2400); // COTO 1800 + YPF 500 + TIENDA 100; SPOTIFY is USD-only
    expect(merchants.map(m => m.merchant)).toEqual(["COTO", "YPF", "TIENDA"]);
    expect(merchants[0]).toMatchObject({ category: "food", total: 1800, count: 3, firstMonth: "2026-06", lastMonth: "2026-07" });
    expect(merchants[0].share).toBeCloseTo(75);
    expect(merchants[2].cumShare).toBeCloseTo(100);
  });

  it("merchantConcentration values an installment at full remaining price in accrual", () => {
    const { merchants } = merchantConcentration(db, o("accrual", "nominal"));
    expect(merchants.find(m => m.merchant === "TIENDA")!.total).toBe(400); // installments 3..6 of 100
  });

  it("merchantNovelty splits spend by first-ever sighting of the merchant", () => {
    const rows = merchantNovelty(db, o("cash", "nominal"));
    expect(rows).toEqual([
      { period: "2026-06", newSpend: 1000, returningSpend: 0, newMerchants: 1 },
      { period: "2026-07", newSpend: 600, returningSpend: 800, newMerchants: 2 },
    ]);
  });

  it("merchantNovelty rebuckets by year but keeps 'new' month-grained", () => {
    // COTO's July charges stay 'returning' inside the 2026 bucket — first sighting was June.
    expect(merchantNovelty(db, o("cash", "nominal"), "year")).toEqual([
      { period: "2026", newSpend: 1600, returningSpend: 800, newMerchants: 3 },
    ]);
  });

  it("merchantConcentration scoped to one period ranks only that period's spend", () => {
    const { merchants, totalSpend } = merchantConcentration(db, o("cash", "nominal"),
      { granularity: "month", period: "2026-07" });
    expect(totalSpend).toBe(1400); // COTO 800 + YPF 500 + TIENDA 100
    expect(merchants[0]).toMatchObject({ merchant: "COTO", total: 800, count: 2 });
  });

  it("installmentBurden splits each billed month into installment vs one-off, always cash", () => {
    // accrual passed in on purpose: the query must force cash internally
    const rows = installmentBurden(db, o("accrual", "nominal"));
    expect(rows[0]).toEqual({ period: "2026-06", installment: 0, oneOff: 1000, plans: 0, sharePct: 0 });
    expect(rows[1]).toMatchObject({ period: "2026-07", installment: 100, oneOff: 1300, plans: 1 });
    expect(rows[1].sharePct).toBeCloseTo(100 / 14);
  });

  it("installmentBurden converts to real pesos at the base month", () => {
    const rows = installmentBurden(db, o("cash", "real"));
    expect(rows[0].oneOff).toBeCloseTo(1100); // 1000 at 2026-06 CPI 100 → base 2026-07 CPI 110
  });

  it("installmentBurden rebuckets by year, counting a series once per period", () => {
    const rows = installmentBurden(db, o("cash", "nominal"), "year");
    expect(rows).toEqual([
      { period: "2026", installment: 100, oneOff: 2300, plans: 1, sharePct: (100 / 2400) * 100 },
    ]);
  });

  it("activePlans lists open series from the latest statement per brand", () => {
    const plans = activePlans(db, o("cash", "nominal"));
    expect(plans).toEqual([{
      merchant: "TIENDA", brand: "visa", paid: 3, total: 6,
      monthly: 100, remainingMonths: 3, remainingTotal: 300,
    }]);
  });

  it("taxBurden classifies levies, excludes DEVOLUCION, and bases the rate on ARS + USD@MEP", () => {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'taxes_and_charges',NULL,'DB.RG 5617 30% ( 1000,00 )','','taxes_fees',NULL,300,NULL,NULL,NULL),
                       (2,'taxes_and_charges',NULL,'IVA RG 4240 21%( 1000,00)','','taxes_fees',NULL,210,NULL,NULL,NULL),
                       (2,'taxes_and_charges',NULL,'INTERESES FINANCIACION $','','taxes_fees',NULL,50,NULL,NULL,NULL),
                       (2,'taxes_and_charges',NULL,'DEVOLUCION DE SALDOS','','taxes_fees',NULL,500,NULL,NULL,NULL)`).run();
    const rows = taxBurden(db, o("cash", "nominal"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2026-07", rg5617: 300, iva: 210, interest: 50, iibb: 0, total: 560 });
    // Base: ARS purchases 1400 (1000 - 200 + 100 + 500) + Spotify 3.73 USD at MEP 1100.
    expect(rows[0].ratePct).toBeCloseTo((560 / (1400 + 3.73 * 1100)) * 100);
  });

  it("taxBurden's yearly rate divides by the whole year's purchases, tax-free months included", () => {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'taxes_and_charges',NULL,'IVA RG 4240 21%( 1000,00)','','taxes_fees',NULL,210,NULL,NULL,NULL)`).run();
    const rows = taxBurden(db, o("cash", "nominal"), "year");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2026", iva: 210, total: 210 });
    // June had purchases (1000) but no tax lines — it still belongs in the denominator.
    expect(rows[0].ratePct).toBeCloseTo((210 / (1000 + 1400 + 3.73 * 1100)) * 100);
  });

  it("recategorize covers the same rows a full ingest would, payments included", () => {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'purchases','2026-07-20','XENEIZE','CUOTA XENEIZE','other',NULL,3000,NULL,NULL,NULL),
                       (2,'payments','2026-07-21','BONIF PROMO CUOTA XENEIZE','BONIF PROMO CUOTA XENEIZE','other',NULL,-500,NULL,NULL,NULL),
                       (2,'taxes_and_charges',NULL,'IVA','IVA CUOTA XENEIZE','taxes_fees',NULL,100,NULL,NULL,NULL)`).run();
    expect(recategorize(db, "CUOTA XENEIZE", "entertainment", "sports")).toBe(2);
    expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE category='taxes_fees'").get()).toEqual({ n: 1 });
  });

  it("statementList reports each statement newest first with its counts", () => {
    const rows = statementList(db);
    expect(rows.map(r => r.file)).toEqual(["m_2026_07.json", "v_2026_07.json", "v_2026_06.json"]);
    expect(rows[0]).toMatchObject({ brand: "mastercard", month: "2026-07", transactions: 1, alerts: 0 });
  });

  it("accrual counts remaining principal at first-observed installment, nets refunds, skips USD-only in sums", () => {
    const r = spendByCategory(db, o("accrual", "nominal"));
    const july = Object.fromEntries(r.filter(x => x.period === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 400, transport: 500 });
  });

  it("cash sums as billed", () => {
    const r = spendByCategory(db, o("cash", "nominal"));
    const july = Object.fromEntries(r.filter(x => x.period === "2026-07").map(x => [x.category, x.amount]));
    expect(july).toEqual({ food: 800, shopping: 100, transport: 500 });
  });

  it("real mode deflates June to July pesos", () => {
    const r = spendByCategory(db, o("cash", "real"));
    expect(r.find(x => x.period === "2026-06" && x.category === "food")!.amount).toBeCloseTo(1100);
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

  it("periodComparison yields null delta after a period netting to zero", () => {
    // 2026-06 nets to zero: the purchase is fully refunded within the period.
    db.prepare("UPDATE transactions SET ars = -1000 WHERE date = '2026-07-12'").run();
    db.prepare("UPDATE transactions SET statement_id = (SELECT id FROM statements WHERE file = 'v_2026_06.json'), date = '2026-06-12' WHERE ars = -1000").run();
    const r = periodComparison(db, o("cash", "nominal"), "month");
    expect(r[0]).toMatchObject({ period: "2026-06", amount: 0 });
    expect(r[1].pctVsPrev).toBeNull();
  });

  it("periodComparison buckets into quarters and years", () => {
    expect(periodComparison(db, o("cash", "nominal"), "quarter").map(x => x.period))
      .toEqual(["2026-Q2", "2026-Q3"]);
    expect(periodComparison(db, o("cash", "nominal"), "year").map(x => x.period)).toEqual(["2026"]);
  });

  it("categoryDrill scopes to one month, quarter or year", () => {
    const food = (f: Parameters<typeof categoryDrill>[2]) =>
      categoryDrill(db, o("cash", "nominal"), f).groups.find(x => x.key === "food")?.amount;
    expect(food({ granularity: "month", period: "2026-06" })).toBe(1000);
    expect(food({ granularity: "quarter", period: "2026-Q2" })).toBe(1000); // 2026-06 alone
    expect(food({ granularity: "quarter", period: "2026-Q3" })).toBe(800);  // 2026-07, refund netted
    expect(food({ granularity: "year", period: "2026" })).toBe(1800);
    expect(food({})).toBe(1800); // unscoped is unchanged
  });

  it("categoryDrill keeps scope and drill independent", () => {
    const { level, rows } = categoryDrill(db, o("cash", "nominal"),
      { category: "food", granularity: "month", period: "2026-06" });
    expect(level).toBe("subcategory");
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe("2026-06");
  });

  it("coverage reports brands per month", () => {
    expect(coverage(db)).toEqual([
      { month: "2026-06", brands: ["visa"] },
      { month: "2026-07", brands: ["mastercard", "visa"] },
    ]);
  });

  it("eli5 aggregates installments across latest statement per brand and honors modes", () => {
    const t = eli5(db, o("cash", "real"));
    expect(t.spentThisMonth).toBeCloseTo(1400);
    expect(t.installmentMonths).toBe(2);
    expect(t.installmentTotal).toBe(350);
    expect(t.baseMonth).toBe("2026-07");
    expect(t.alerts).toEqual([]);
    const nom = eli5(db, o("cash", "nominal"));
    expect(nom.sparkline.find(s => s.month === "2026-06")!.amount).toBe(1000);
  });

  it("eli5 values the installment total in the active mode, not raw pesos", () => {
    // upcoming_installments is nominal ARS: 200 + 100 + 50. USD mode must divide by the
    // latest month's MEP, not print 350 behind a US$ sign.
    expect(eli5(db, o("cash", "usd")).installmentTotal).toBeCloseTo(350 / 1100);
    expect(eli5(db, o("cash", "nominal")).installmentTotal).toBe(350);
  });

  it("eli5 throws actionable error on empty DB", () => {
    const empty = openDb(":memory:");
    expect(() => eli5(empty, o("cash", "real"))).toThrow(/npm run ingest/);
  });
});

describe("installment series identity", () => {
  it("keys each series by its purchase date — two series, one merchant, one count", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_07.json'").get() as { id: number }).id;
    const ins = db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'purchases', ?, 'ML', 'MERCADOLIBRE', 'shopping', NULL, 1000, NULL, ?, 6)`
    );
    ins.run(sid, "2026-01-05", 1);  // series A, first installment observed
    ins.run(sid, "2026-05-20", 4);  // series B, first observed at k=4
    const shopping = spendByCategory(db, o("accrual", "nominal"))
      .filter(r => r.period === "2026-07" && r.category === "shopping")
      .reduce((s, r) => s + r.amount, 0);
    // A: 1000 x 6 = 6000. B: 1000 x (6-4+1) = 3000. Plus the seeded TIENDA 100 x (6-3+1) = 400.
    expect(shopping).toBeCloseTo(9400, 6);
  });
});

describe("all granularity", () => {
  const db = openAndSeed();

  it("collapses spendByCategory to one bucket per category", () => {
    const all = spendByCategory(db, o("cash", "nominal"), "all");
    expect([...new Set(all.map(r => r.period))]).toEqual(["all"]);
    const byMonth = spendByCategory(db, o("cash", "nominal"));
    expect(all.reduce((s, r) => s + r.amount, 0))
      .toBeCloseTo(byMonth.reduce((s, r) => s + r.amount, 0), 6);
  });

  it("collapses periodTotals and periodComparison to a single unchanged total", () => {
    const [only, ...rest] = periodTotals(db, o("cash", "nominal"), "all");
    expect(rest).toEqual([]);
    expect(only.period).toBe("all");
    const months = periodTotals(db, o("cash", "nominal"));
    expect(only.amount).toBeCloseTo(months.reduce((s, m) => s + m.amount, 0), 6);
    // One bucket has no predecessor, so the delta is undefined rather than 0%.
    expect(periodComparison(db, o("cash", "nominal"), "all"))
      .toEqual([{ period: "all", amount: only.amount, pctVsPrev: null }]);
  });

  it("scopes categoryDrill and sankeyFlows to the whole history", () => {
    const scoped = categoryDrill(db, o("cash", "nominal"), { granularity: "all", period: "all" });
    expect(scoped.groups).toEqual(categoryDrill(db, o("cash", "nominal"), {}).groups);
    // Every month's flows in one diagram, so the total is the sum of the monthly ones.
    const total = (l: { value: number }[]) => l.reduce((s, x) => s + x.value, 0);
    const allFlows = sankeyFlows(db, o("cash", "nominal"), "all", "all");
    expect(total(allFlows.links)).toBeGreaterThan(
      total(sankeyFlows(db, o("cash", "nominal"), "2026-07").links)
    );
  });
});

import { toMode } from "@/lib/queries";

const monthTotal = (rows: { period: string; amount: number }[], month: string) =>
  rows.filter(r => r.period === month).reduce((s, r) => s + r.amount, 0);

describe("USD value mode", () => {
  it("converts ARS rows at the month's MEP rate", () => {
    const db = openDb(":memory:");
    seed(db);
    const usd = monthTotal(spendByCategory(db, o("cash", "usd")), "2026-06");
    const nominal = monthTotal(spendByCategory(db, o("cash", "nominal")), "2026-06");
    expect(usd).toBeCloseTo(nominal / 1000, 6);
  });

  it("counts USD-billed rows at face value — the one place they enter aggregates", () => {
    const db = openDb(":memory:");
    seed(db);
    const subs = (mode: ValueMode) =>
      spendByCategory(db, o("cash", mode))
        .filter(r => r.period === "2026-07" && r.category === "subscriptions")
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
    expect(monthTotal(spendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1100, 6);
    expect(monthTotal(spendByCategory(db, o("cash", "nominal", "excl")), "2026-06")).toBeCloseTo(1000, 6);
  });

  it("ignores DEVOLUCION DE SALDOS — a balance transfer, not a tax", () => {
    const db = openDb(":memory:");
    seed(db);
    const sid = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
       VALUES (?, 'taxes_and_charges', NULL, 'DEVOLUCION DE SALDOS', 'DEVOLUCION DE SALDOS', 'taxes_fees', NULL, 5000, NULL, NULL, NULL)`
    ).run(sid);
    expect(monthTotal(spendByCategory(db, o("cash", "nominal", "incl")), "2026-06")).toBeCloseTo(1000, 6);
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
    expect(monthTotal(spendByCategory(db, o("cash", "nominal", "excl")), "2026-07")).toBeCloseTo(1400, 6);
    expect(monthTotal(spendByCategory(db, o("cash", "nominal", "incl")), "2026-07")).toBeCloseTo(900 * 1.1 + 500, 6);
  });

  it("leaves statements with no tax rows alone", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = (tax: TaxMode) => monthTotal(spendByCategory(db, o("cash", "nominal", tax)), "2026-07");
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
    const jul = currencySplit(db, o("cash", "usd")).find(r => r.period === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73, 6);  // the seeded Spotify row
    expect(jul.arsBilled).toBeGreaterThan(0);
  });
  it("reports USD-billed spend in pesos when the mode is nominal", () => {
    const db = openDb(":memory:");
    seed(db);
    const jul = currencySplit(db, o("cash", "nominal")).find(r => r.period === "2026-07")!;
    expect(jul.usdBilled).toBeCloseTo(3.73 * 1100, 6);
    expect(jul.arsBilled).toBeCloseTo(1400, 6);  // 1000 - 200 + 100 + 500
  });
  it("leaves months without USD-billed rows at zero", () => {
    const db = openDb(":memory:");
    seed(db);
    expect(currencySplit(db, o("cash", "nominal")).find(r => r.period === "2026-06")!.usdBilled).toBe(0);
  });
});

import { installmentProjection, latestStatementIds } from "@/lib/queries";

describe("installmentProjection", () => {
  it("takes the certain layer only from the newest statement per brand", () => {
    const db = openDb(":memory:");
    seed(db);
    // The June Visa statement is superseded by the July one. Its schedule must not be added.
    const june = (db.prepare("SELECT id FROM statements WHERE file = 'v_2026_06.json'").get() as { id: number }).id;
    db.prepare("INSERT INTO upcoming_installments (statement_id, month, amount_ars) VALUES (?, '2026-08', 9999)").run(june);

    expect(latestStatementIds(db)).toHaveLength(2); // one visa, one mastercard
    const p = installmentProjection(db, o("cash", "nominal"), 3);
    expect(p.map(x => x.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(p[0].certain).toBeCloseTo(250, 6); // 200 (visa July) + 50 (mastercard), never 10249
    expect(p[1].certain).toBeCloseTo(100, 6);
    expect(p[2].certain).toBe(0);
  });

  it("returns nothing when no statements are ingested", () => {
    expect(installmentProjection(openDb(":memory:"), o("cash", "nominal"))).toEqual([]);
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
  it("counts an installment series once at full price, not once per statement", () => {
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

import { weekdayProfile, ticketTrend, moneyBack, paymentFloat } from "@/lib/queries";

describe("weekdayProfile", () => {
  it("buckets accrual spend by purchase weekday, Monday first, refunds netting but not counting", () => {
    const db = openDb(":memory:");
    seed(db);
    const days = weekdayProfile(db, o("cash", "nominal")); // cash on purpose: accrual is forced
    expect(days.map(d => d.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const wed = days.find(d => d.day === "Wed")!;
    expect(wed).toMatchObject({ total: 1500, count: 2 }); // COTO June + YPF, both Wednesdays
    expect(wed.byCategory).toEqual({ food: 1000, transport: 500 });
    // TIENDA installment 3/6 on a Saturday: full remaining principal, once.
    expect(days.find(d => d.day === "Sat")!).toMatchObject({ total: 400, count: 1 });
    // The Sunday refund nets the total but is not a visit.
    expect(days.find(d => d.day === "Sun")!).toMatchObject({ total: -200, count: 0 });
  });
});

describe("ticketTrend", () => {
  it("counts each purchase once at full price and reports avg and midpoint median", () => {
    const rows = ticketTrend(openAndSeed(), o("cash", "nominal"));
    expect(rows[0]).toEqual({ period: "2026-06", count: 1, total: 1000, avgTicket: 1000, medianTicket: 1000 });
    // July tickets: COTO 1000, TIENDA 400 (remaining principal), YPF 500. Refund excluded.
    expect(rows[1]).toMatchObject({ period: "2026-07", count: 3, total: 1900, medianTicket: 500 });
    expect(rows[1].avgTicket).toBeCloseTo(1900 / 3);
  });

  it("admits USD-billed rows only in usd mode", () => {
    const db = openAndSeed();
    expect(ticketTrend(db, o("cash", "usd"))[1].count).toBe(4);     // Spotify joins
    expect(ticketTrend(db, o("cash", "nominal"))[1].count).toBe(3); // and only there
  });

  it("averages the two middles on an even sample", () => {
    const db = openAndSeed();
    db.prepare("DELETE FROM transactions WHERE merchant = 'YPF'").run();
    expect(ticketTrend(db, o("cash", "nominal"))[1].medianTicket).toBe(700); // (400 + 1000) / 2
  });
});

function openAndSeed(): Database.Database {
  const db = openDb(":memory:");
  seed(db);
  return db;
}

describe("moneyBack", () => {
  function seedCredits(db: Database.Database) {
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (2,'payments','2026-07-05','BONIF.PROMO CUOTA XENEIZE','BONIF PROMO CUOTA XENEIZE','entertainment','sports',-500,NULL,NULL,NULL),
                       (2,'payments',NULL,'CR.RG 5617 30% M (M)','CR RG 5617 30% M M','taxes_fees',NULL,-300,NULL,NULL,NULL),
                       (2,'payments','2026-07-06','SU PAGO EN PESOS','SU PAGO EN PESOS','transfers',NULL,-10000,NULL,NULL,NULL)`).run();
  }

  it("splits credits into promo / refund / taxback and rates them against positive purchases", () => {
    const db = openAndSeed();
    seedCredits(db);
    const { periods, top } = moneyBack(db, o("cash", "nominal"));
    expect(periods).toHaveLength(1); // June has no credits: no bucket, not a zero row
    // COTO DEVOL -200 is the seeded purchases-section reversal.
    expect(periods[0]).toMatchObject({ period: "2026-07", promo: 500, refund: 200, taxback: 300, total: 1000 });
    expect(periods[0].pctOfSpend).toBeCloseTo((1000 / 1600) * 100); // vs COTO 1000 + TIENDA 100 + YPF 500
    expect(top.map(t => t.amount)).toEqual([500, 300, 200]);
    expect(top[0].kind).toBe("promo");
  });

  it("never counts the user's own payments as money back", () => {
    const db = openAndSeed();
    seedCredits(db);
    const { top } = moneyBack(db, o("cash", "nominal"));
    expect(top.some(t => t.description.startsWith("SU PAGO"))).toBe(false);
  });

  it("buckets by quarter and keeps the rate nominal in real mode", () => {
    const db = openAndSeed();
    seedCredits(db);
    const { periods } = moneyBack(db, o("cash", "real"), "quarter");
    expect(periods[0].period).toBe("2026-Q3");
    expect(periods[0].pctOfSpend).toBeCloseTo((1000 / 1600) * 100); // July-only, CPI cancels anyway
  });
});

describe("paymentFloat", () => {
  it("measures purchase-to-due days and the real-terms gain of paying later", () => {
    const rows = paymentFloat(openAndSeed(), cpi);
    const june = rows.find(r => r.period === "2026-06")!;
    expect(june.avgDays).toBe(27); // 2026-06-10 -> due 2026-07-07
    // 1000 pesos: worth 1100 base pesos at purchase (CPI 100), 1000 at the July due date.
    expect(june.gain).toBeCloseTo(100);
    expect(june.gainPct).toBeCloseTo((100 / 1100) * 100);
    expect(june.avgDaysInstallment).toBeNull();
  });

  it("splits one-off from installment float — the cuota rows carry their original purchase date", () => {
    const july = paymentFloat(openAndSeed(), cpi).find(r => r.period === "2026-07")!;
    expect(july.avgDaysOneOff).toBeCloseTo((28 * 1000 + 26 * 500) / 1500); // COTO + YPF, due-date weighted
    expect(july.avgDaysInstallment).toBe(27); // TIENDA 2026-07-11 -> visa due 2026-08-07
    // Both CPI legs fall back to the table's last month (2026-07): zero gain, never invented.
    expect(july.gain).toBe(0);
  });

  it("clamps purchase months older than the CPI table instead of throwing", () => {
    const db = openAndSeed();
    db.prepare(`INSERT INTO transactions (statement_id, section, date, description, merchant, category, subcategory, ars, usd, installment_number, installment_count)
                VALUES (1,'purchases','2023-12-15','OLD PLAN','OLD PLAN','shopping',NULL,1000,NULL,17,18)`).run();
    const june = paymentFloat(db, cpi).find(r => r.period === "2026-06")!;
    // Clamped to the first CPI month: the old row contributes the same gain as a June purchase.
    expect(june.gain).toBeCloseTo(200);
  });
});
