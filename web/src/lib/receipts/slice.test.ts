import { describe, it, expect } from "vitest";
import * as mupdf from "mupdf";
import { planSlices, cropSlice, mapBoxToPage, dedupeBoxes, ownsBox } from "@/lib/receipts/slice";

describe("planSlices", () => {
  it("does not slice a page whose own aspect ratio is already reasonable", () => {
    expect(planSlices(600, 800)).toEqual([{ y0: 0, y1: 800 }]);
    expect(planSlices(600, 600)).toEqual([{ y0: 0, y1: 600 }]);
  });

  it("slices a tall page into more than one overlapping chunk", () => {
    const plans = planSlices(600, 4800); // aspect 8: a typical receipt scan
    expect(plans.length).toBeGreaterThan(1);
  });

  it("covers the whole page with no gap between consecutive slices", () => {
    const plans = planSlices(600, 4800);
    expect(plans[0].y0).toBe(0);
    expect(plans[plans.length - 1].y1).toBe(4800);
    for (let i = 1; i < plans.length; i++) {
      // Slice i must start at or before the previous slice's end (an overlap, never a gap).
      expect(plans[i].y0).toBeLessThanOrEqual(plans[i - 1].y1);
    }
  });

  it("overlaps neighbouring slices by a real span, not a single pixel", () => {
    const plans = planSlices(600, 4800);
    const overlap = plans[0].y1 - plans[1].y0;
    expect(overlap).toBeGreaterThan(20);
  });

  it("scales the number of slices with the page's own aspect ratio, not a fixed count", () => {
    const short = planSlices(600, 3600).length; // aspect 6
    const tall = planSlices(600, 7200).length; // aspect 12, twice as tall
    expect(tall).toBeGreaterThan(short);
  });

  it("never produces a slice reaching past the page height", () => {
    const plans = planSlices(617, 4761); // one of the real receipts' native dimensions
    for (const s of plans) {
      expect(s.y0).toBeGreaterThanOrEqual(0);
      expect(s.y1).toBeLessThanOrEqual(4761);
      expect(s.y1).toBeGreaterThan(s.y0);
    }
  });
});

describe("mapBoxToPage", () => {
  it("leaves an unsliced page's box untouched", () => {
    const box = { x: 0.1, y: 0.5, w: 0.3, h: 0.02 };
    const mapped = mapBoxToPage(box, { y0: 0, y1: 1000 }, 1000);
    expect(mapped).toEqual(box);
  });

  it("maps a box found in a lower slice to its whole-page fraction", () => {
    // A 4000px page sliced so the third slice covers pixels 2000..3000.
    const slice = { y0: 2000, y1: 3000 };
    // Vision found the box at 50% down *that slice* (pixel 2500), 1% tall within it.
    const box = { x: 0.2, y: 0.5, w: 0.4, h: 0.01 };
    const mapped = mapBoxToPage(box, slice, 4000);
    expect(mapped.y).toBeCloseTo(2500 / 4000, 6);
    expect(mapped.h).toBeCloseTo((0.01 * 1000) / 4000, 6);
    // x/w are untouched: slices span the full page width.
    expect(mapped.x).toBe(0.2);
    expect(mapped.w).toBe(0.4);
  });

  it("keeps extra fields on the box (e.g. text) untouched", () => {
    const box = { x: 0, y: 0.1, w: 1, h: 0.02, text: "TOTAL", page: 1 };
    const mapped = mapBoxToPage(box, { y0: 100, y1: 600 }, 1000);
    expect(mapped.text).toBe("TOTAL");
    expect(mapped.page).toBe(1);
  });
});

describe("ownsBox", () => {
  // Three slices with 100px overlap bands: [0,500], [400,900], [800,1200].
  const plans = [{ y0: 0, y1: 500 }, { y0: 400, y1: 900 }, { y0: 800, y1: 1200 }];
  it("gives each slice its own interior outright", () => {
    expect(ownsBox(plans, 0, 200)).toBe(true);
    expect(ownsBox(plans, 1, 650)).toBe(true);
    expect(ownsBox(plans, 2, 1100)).toBe(true);
  });
  it("splits an overlap band at its midpoint: the upper slice owns above it, the lower at or below", () => {
    expect(ownsBox(plans, 0, 440)).toBe(true);   // above 450: slice 0's half
    expect(ownsBox(plans, 1, 440)).toBe(false);  // slice 1 read it near its own top cut
    expect(ownsBox(plans, 0, 460)).toBe(false);  // below 450: slice 0 read it near its bottom cut
    expect(ownsBox(plans, 1, 460)).toBe(true);
    expect(ownsBox(plans, 0, 450)).toBe(false);  // exactly on the midpoint: exactly one owner
    expect(ownsBox(plans, 1, 450)).toBe(true);
  });
  it("drops a garbled fragment read right at a cut even though nothing else sits at its position", () => {
    // Real case: Vision returned "MEKLADO" for the half-visible line at the very top of slice 1;
    // the clean reading of that line came from slice 0, further from the cut.
    expect(ownsBox(plans, 1, 402)).toBe(false);
  });
  it("owns everything when there is no overlap or a single slice", () => {
    expect(ownsBox([{ y0: 0, y1: 1000 }], 0, 999)).toBe(true);
    expect(ownsBox([{ y0: 0, y1: 500 }, { y0: 500, y1: 1000 }], 0, 499)).toBe(true);
    expect(ownsBox([{ y0: 0, y1: 500 }, { y0: 500, y1: 1000 }], 1, 500)).toBe(true);
  });
});

describe("dedupeBoxes", () => {
  it("drops a box that lands in the same spot on the same page, read from a different slice", () => {
    const a = { page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "TOTAL 84288.50", source: 3 };
    const b = { page: 1, x: 0.1, y: 0.4005, w: 0.5, h: 0.01, text: "TOTAL 84288.50", source: 4 };
    expect(dedupeBoxes([a, b])).toEqual([a]);
  });

  it("does not require identical text: a duplicate reading is often garbled differently", () => {
    // The real failure mode this guards: two overlap reads of one printed line, misread
    // differently by Vision each time, must still collapse to one — same spot, same slice pair.
    const a = { page: 1, x: 0.06, y: 0.4, w: 0.4, h: 0.01, text: "VERDURAS GRILLADAS COTOX KG", source: 3 };
    const b = { page: 1, x: 0.06, y: 0.4004, w: 0.4, h: 0.01, text: "VEKDUKAS GRILLADAS LUTUX Kia", source: 4 };
    expect(dedupeBoxes([a, b])).toHaveLength(1);
  });

  it("prefers the reading further from its own slice's cut edge when scores are given", () => {
    const nearEdge = { page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "GARBLED VVERSION", source: 3, score: 0.02 };
    const central = { page: 1, x: 0.1, y: 0.4003, w: 0.5, h: 0.01, text: "CLEAN VERSION", source: 4, score: 0.4 };
    expect(dedupeBoxes([nearEdge, central])).toEqual([central]);
    expect(dedupeBoxes([central, nearEdge])).toEqual([central]); // order-independent
  });

  it("keeps two boxes at genuinely different positions", () => {
    const a = { page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.01, text: "1", source: 1 };
    const b = { page: 1, x: 0.1, y: 0.9, w: 0.3, h: 0.01, text: "1", source: 2 };
    expect(dedupeBoxes([a, b])).toEqual([a, b]);
  });

  it("never merges two boxes that came from the same slice, even at the same spot", () => {
    // Vision does not detect one line twice inside a single image; a same-slice "duplicate" would
    // mean two genuinely different, tightly-packed lines — never collapse those.
    const a = { page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "A", source: 3 };
    const b = { page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "B", source: 3 };
    expect(dedupeBoxes([a, b])).toEqual([a, b]);
  });

  it("does not dedupe the same spot on different pages", () => {
    const a = { page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "TOTAL", source: 3 };
    const b = { page: 2, x: 0.1, y: 0.4, w: 0.5, h: 0.01, text: "TOTAL", source: 4 };
    expect(dedupeBoxes([a, b])).toEqual([a, b]);
  });

  it("keeps two adjacent printed lines whose tall boxes overlap vertically", () => {
    // Real 3× scan: the quantity line and the description right under it. Vision's boxes are
    // taller than the line pitch, so their centres sit only 0.0104 apart while each box is 0.018
    // tall — a tolerance measured in box heights must still tell them apart.
    const qty = { page: 1, x: 0.102, y: 0.6547, w: 0.286, h: 0.0180, text: "1,072 x 2999,00", source: 2 };
    const desc = { page: 1, x: 0.055, y: 0.6653, w: 0.388, h: 0.0176, text: "-BANANA CAVENDISHX KG", source: 3 };
    expect(dedupeBoxes([desc, qty])).toEqual([desc, qty]);
    // And the other real case: a description whose box is much taller than the quantity line's.
    const qty2 = { page: 1, x: 0.117, y: 0.1926, w: 0.295, h: 0.0077, text: "4,000 x 3390,00", source: 1 };
    const desc2 = { page: 1, x: 0.056, y: 0.1953, w: 0.929, h: 0.0132, text: "AGUA SIN GAS V.D.S LEVITE", source: 2 };
    expect(dedupeBoxes([qty2, desc2])).toEqual([qty2, desc2]);
  });

  it("does not dedupe boxes beside each other horizontally on the same line", () => {
    const a = { page: 1, x: 0.1, y: 0.4, w: 0.05, h: 0.01, text: "1", source: 3 };
    const b = { page: 1, x: 0.5, y: 0.4, w: 0.05, h: 0.01, text: "1", source: 4 };
    expect(dedupeBoxes([a, b])).toEqual([a, b]);
  });
});

describe("cropSlice", () => {
  it("crops a pixmap to the slice's exact pixel bounds using mupdf's own warp", () => {
    const width = 200, height = 800;
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
    try {
      pix.clear(255);
      const slice = { y0: 300, y1: 500 };
      const cropped = cropSlice(pix, width, slice);
      try {
        expect(cropped.getWidth()).toBe(width);
        expect(cropped.getHeight()).toBe(200);
        // A real, decodable PNG comes out the other end.
        const png = Buffer.from(cropped.asPNG());
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      } finally {
        cropped.destroy();
      }
    } finally {
      pix.destroy();
    }
  });
});
