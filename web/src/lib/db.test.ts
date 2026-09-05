import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate, openDb } from "@/lib/db";

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

  it("widens a pre-bank-terms statements table with the new columns", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE statements (
      id INTEGER PRIMARY KEY, file TEXT UNIQUE NOT NULL, brand TEXT NOT NULL,
      closing_date TEXT NOT NULL, cycle_month TEXT NOT NULL, due_date TEXT,
      prev_closing_date TEXT, balance_ars REAL, balance_usd REAL, minimum_payment_ars REAL
    )`);
    migrate(db);
    db.prepare(
      `INSERT INTO statements (file, brand, closing_date, cycle_month, limit_purchase, rate_tem_pct)
       VALUES ('a.json','visa','2026-01-29','2026-01', 20000000, 5.707)`
    ).run();
    expect(db.prepare("SELECT limit_purchase, rate_tem_pct FROM statements").get())
      .toEqual({ limit_purchase: 20000000, rate_tem_pct: 5.707 });
    migrate(db); // idempotent: a second run must not re-ALTER
  });

  it("stores a receipt with its items and discounts, and cascades on delete", () => {
    const db = openDb(":memory:");
    const r = db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', '2090-06514979', 'abc', '/x/abc.pdf', 14693191, -3720357, 10972834, '{}', '{}', 'ocr', 3, '2026-09-04T12:00:00Z')`
    ).run();
    const item = db.prepare(
      `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, ean, qty_milli, unit, unit_price_cents, line_total_cents)
       VALUES (?, 1, 'VERDURAS GRILLADAS COTOX KG', '0000038072', '02538072001727', 172, 'kg', 2589900, 445463)`
    ).run(r.lastInsertRowid);
    db.prepare(`INSERT INTO receipt_discounts (item_id, position, label, tag, amount_cents) VALUES (?, 1, '1 *30% ELABORADOS', 'A', -133639)`)
      .run(item.lastInsertRowid);
    db.prepare(`INSERT INTO receipt_transcripts (receipt_id, kind, text) VALUES (?, 'ocr', 'TOTAL\t1,00')`).run(r.lastInsertRowid);
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_discounts").get()).toEqual({ n: 1 });
    db.prepare("DELETE FROM receipts").run();
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_items").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_discounts").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_transcripts").get()).toEqual({ n: 0 });
  });

  it("refuses a second receipt with the same ticket number or the same file hash", () => {
    const db = openDb(":memory:");
    const ins = (fiscal: string, sha: string) => db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', ?, ?, '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run(fiscal, sha);
    ins("2090-1", "sha-1");
    expect(() => ins("2090-1", "sha-2")).toThrow();
    expect(() => ins("2090-2", "sha-1")).toThrow();
    expect(() => db.prepare(`INSERT INTO receipt_items (receipt_id, position, desc_printed, qty_milli, unit, line_total_cents) VALUES (1, 1, 'x', 1000, 'lb', 1)`).run()).toThrow();
  });

  it("keys products by article code and cascades codes, rules and matches with the product", () => {
    const db = openDb(":memory:");
    const p = db.prepare(`INSERT INTO products (name, category, unit, created_at) VALUES ('Banana Cavendish (por kg)', 'produce', 'kg', 'now')`).run();
    const pid = Number(p.lastInsertRowid);
    db.prepare(`INSERT INTO product_codes (chain, sku, ean, product_id) VALUES ('coto', '0000000446', '02500446010727', ?)`).run(pid);
    db.prepare(`INSERT INTO product_rules (position, chain, match, product_id) VALUES (0, 'coto', 'BANANA CAVENDISH', ?)`).run(pid);
    const r = db.prepare(
      `INSERT INTO receipts (chain, date, fiscal_number, file_sha256, file_path, subtotal_cents, discounts_cents, total_cents,
         header_json, verification_json, transcript_source, ocr_scale, created_at)
       VALUES ('coto', '2026-09-04', '2090-1', 'sha', '/x', 1, 0, 1, '{}', '{}', 'ocr', 3, 'now')`).run();
    const item = db.prepare(
      `INSERT INTO receipt_items (receipt_id, position, desc_printed, sku, qty_milli, unit, line_total_cents)
       VALUES (?, 1, '=BANANA CAVENDISHX KG', '0000000446', 1072, 'kg', 246453)`).run(r.lastInsertRowid);
    db.prepare(`INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, 'code')`).run(item.lastInsertRowid, pid);
    // a second code for the same product is fine; the same code twice for the chain is not
    db.prepare(`INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000447', ?)`).run(pid);
    expect(() => db.prepare(`INSERT INTO product_codes (chain, sku, product_id) VALUES ('coto', '0000000446', ?)`).run(pid)).toThrow();
    expect(() => db.prepare(`INSERT INTO product_matches (item_id, product_id, method) VALUES (?, ?, 'guess')`).run(item.lastInsertRowid, pid)).toThrow();
    db.prepare("DELETE FROM products").run();
    expect(db.prepare("SELECT COUNT(*) n FROM product_codes").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM product_rules").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM product_matches").get()).toEqual({ n: 0 });
    // the receipt item itself is untouched: products are a layer over receipts, not part of them
    expect(db.prepare("SELECT COUNT(*) n FROM receipt_items").get()).toEqual({ n: 1 });
  });

  it("adds fingerprint to an older transactions table and backfills it, numbering identical lines", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE statements (id INTEGER PRIMARY KEY, file TEXT UNIQUE NOT NULL, brand TEXT NOT NULL,
        closing_date TEXT NOT NULL, cycle_month TEXT NOT NULL, due_date TEXT, prev_closing_date TEXT,
        balance_ars REAL, balance_usd REAL, minimum_payment_ars REAL);
      CREATE TABLE transactions (id INTEGER PRIMARY KEY, statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
        section TEXT NOT NULL, date TEXT, description TEXT NOT NULL, merchant TEXT NOT NULL, category TEXT NOT NULL,
        subcategory TEXT, ars REAL, usd REAL, installment_number INTEGER, installment_count INTEGER);
      INSERT INTO statements (file, brand, closing_date, cycle_month) VALUES ('v.pdf', 'visa', '2026-08-29', '2026-08');
      INSERT INTO transactions (statement_id, section, date, description, merchant, category, ars) VALUES
        (1, 'purchases', '2026-08-07', 'MERPAGO*COTO', 'COTO', 'food', 115370.8),
        (1, 'purchases', '2026-08-07', 'MERPAGO*COTO', 'COTO', 'food', 115370.8),
        (1, 'purchases', '2026-08-09', 'CAFE', 'CAFE', 'food', 2500);
    `);
    migrate(db);
    const fps = (db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all() as { fingerprint: string }[]).map(r => r.fingerprint);
    expect(fps.every(f => /^[0-9a-f]{40}$/.test(f))).toBe(true);
    expect(new Set(fps).size).toBe(3);
    migrate(db); // idempotent: no re-ALTER, no rewrite
    expect((db.prepare("SELECT fingerprint FROM transactions ORDER BY id").all() as { fingerprint: string }[]).map(r => r.fingerprint)).toEqual(fps);
  });
});
