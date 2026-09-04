// Every transcript the acceptance run recorded must still pass the gate and land on the
// prototype's totals. Runs in plain `npm test`: no PDF, no OCR, just the parser and the verifier.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseRowsText } from "@/lib/receipts/rows";
import { parseRows } from "@/lib/receipts/parse";
import { verify } from "@/lib/receipts/verify";

const ROWS = path.join(__dirname, "__fixtures__", "rows");
const EXPECTED = path.join(__dirname, "__fixtures__", "expected");
const files = fs.existsSync(ROWS) ? fs.readdirSync(ROWS).filter(f => f.endsWith(".rows.txt")).sort() : [];

describe.skipIf(files.length === 0)("recorded transcripts", () => {
  for (const file of files) {
    const date = file.replace(".rows.txt", "");
    it(`${date} still reconciles`, () => {
      const parsed = parseRows(parseRowsText(fs.readFileSync(path.join(ROWS, file), "utf8")));
      const report = verify(parsed);
      expect(report.errors).toEqual([]);
      expect(report.checks.every(c => c.ok), JSON.stringify(report.checks)).toBe(true);
      const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED, `${date}.json`), "utf8")) as
        { date: string; total_printed: number; items: unknown[] };
      expect(parsed.header.date).toBe(expected.date);
      expect(parsed.footer.totalCents).toBe(Math.round(expected.total_printed * 100));
      expect(parsed.items).toHaveLength(expected.items.length);
    });
  }
});
