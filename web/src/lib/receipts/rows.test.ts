import { describe, it, expect } from "vitest";
import { boxesToRows, serializeRows, parseRowsText, type Row } from "@/lib/receipts/rows";
import type { Box } from "@/lib/receipts/ocr";

// Real Vision output for one item of the 2026-09-04 receipt (page fractions, origin top-left).
// The large-font line total sits on the code row; the [A] tag is its own box mid-row.
const boxes: Box[] = [
  { page: 1, x: 0.117, y: 0.2197, w: 0.30, h: 0.008, text: "0,172 x 25899,00" },
  { page: 1, x: 0.063, y: 0.2286, w: 0.55, h: 0.008, text: "VERDURAS GRILLADAS COTOX KG" },
  { page: 1, x: 0.696, y: 0.2368, w: 0.22, h: 0.011, text: "4454,63" },
  { page: 1, x: 0.062, y: 0.2376, w: 0.48, h: 0.008, text: "0000038072 02538072001727" },
  { page: 1, x: 0.062, y: 0.2467, w: 0.31, h: 0.008, text: "1 *30% ELABORADOS" },
  { page: 1, x: 0.471, y: 0.2467, w: 0.04, h: 0.008, text: "[A]" },
  { page: 1, x: 0.808, y: 0.2467, w: 0.11, h: 0.008, text: "-1336,39" },
  // second page, deliberately out of order in the input
  { page: 2, x: 0.700, y: 0.0500, w: 0.20, h: 0.011, text: "27120,97" },
  { page: 2, x: 0.060, y: 0.0505, w: 0.20, h: 0.008, text: "TOTAL" },
];

describe("boxesToRows", () => {
  it("groups boxes by line, joins labels left to right, pulls the amount out", () => {
    expect(boxesToRows(boxes)).toEqual<Row[]>([
      { page: 1, label: "0,172 x 25899,00", amount: null },
      { page: 1, label: "VERDURAS GRILLADAS COTOX KG", amount: null },
      { page: 1, label: "0000038072 02538072001727", amount: "4454,63" },
      { page: 1, label: "1 *30% ELABORADOS [A]", amount: "-1336,39" },
      { page: 2, label: "TOTAL", amount: "27120,97" },
    ]);
  });

  it("does not mistake a left-column number for the amount", () => {
    const rows = boxesToRows([
      { page: 1, x: 0.06, y: 0.5, w: 0.1, h: 0.008, text: "3172,00" },
      { page: 1, x: 0.30, y: 0.5, w: 0.2, h: 0.008, text: "SAL FINA" },
    ]);
    expect(rows).toEqual([{ page: 1, label: "3172,00 SAL FINA", amount: null }]);
  });

  it("returns nothing for no boxes", () => {
    expect(boxesToRows([])).toEqual([]);
  });
});

describe("rows text", () => {
  const rows: Row[] = [
    { page: 1, label: "TOTAL", amount: "109728,34" },
    { page: 1, label: "", amount: "21950,00" },
    { page: 2, label: "SU VUELTO", amount: "0,00" },
    { page: 2, label: "ART:040 TRX:4969", amount: null },
  ];

  it("round-trips", () => {
    const text = serializeRows(rows);
    expect(text).toBe("## page 1\nTOTAL\t109728,34\n\t21950,00\n## page 2\nSU VUELTO\t0,00\nART:040 TRX:4969\n");
    expect(parseRowsText(text)).toEqual(rows);
  });

  it("accepts two spaces instead of a tab, and Windows line endings", () => {
    expect(parseRowsText("TOTAL   109728,34\r\nART:040  TRX:4969\r\n")).toEqual([
      { page: 1, label: "TOTAL", amount: "109728,34" },
      { page: 1, label: "ART:040  TRX:4969", amount: null }, // not amount-shaped: stays in the label
    ]);
  });

  it("skips blank lines", () => {
    expect(parseRowsText("\n\n## page 3\n\nX\n")).toEqual([{ page: 3, label: "X", amount: null }]);
  });
});
