import { describe, it, expect } from "vitest";
import { renderPages } from "@/lib/receipts/pdf";

// A one-page PDF with a 100×200 pt page and no cross-reference table: mupdf repairs it and
// renders a blank page, which is all this test needs to check dimensions and scaling.
const MINI_PDF = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`);

describe("renderPages", () => {
  it("renders one PNG per page at the page's pixel size", () => {
    const pages = renderPages(MINI_PDF);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, width: 100, height: 200 });
    // PNG signature
    expect(pages[0].png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("scales the raster", () => {
    const [page] = renderPages(MINI_PDF, 3);
    expect(page.width).toBe(300);
    expect(page.height).toBe(600);
  });

  it("throws on bytes that are not a PDF", () => {
    expect(() => renderPages(Buffer.from("not a pdf"))).toThrow();
  });
});
