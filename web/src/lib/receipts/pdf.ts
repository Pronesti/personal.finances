import * as mupdf from "mupdf";

export type PageImage = { page: number; png: Buffer; width: number; height: number };

/**
 * Every page of a receipt PDF as a PNG. The scans are stored as one tall image per page at 72
 * ppi, so scale 1 reproduces the embedded pixels and scale 3 is what Vision reads best.
 * Pure Node: mupdf is WebAssembly, no poppler on the machine required.
 */
export function renderPages(pdf: Buffer, scale = 1): PageImage[] {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  try {
    const out: PageImage[] = [];
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      try {
        // A matrix is six numbers; [s 0 0 s 0 0] scales both axes.
        const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
        try {
          out.push({
            page: i + 1,
            png: Buffer.from(pix.asPNG()),
            width: pix.getWidth(),
            height: pix.getHeight(),
          });
        } finally {
          pix.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return out;
  } finally {
    doc.destroy();
  }
}
