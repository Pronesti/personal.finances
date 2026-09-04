import * as mupdf from "mupdf";

/** Pixel bounds of one horizontal slice of a page image. Slices may overlap their neighbours. */
export type SlicePlan = { y0: number; y1: number };

// The prototype that produced the acceptance fixtures sliced each page into ~5 overlapping
// horizontal chunks (~60px overlap) before transcribing — a very tall, narrow page is Vision's
// worst case, since it normalises the input and small text on a 4000px-tall page loses the pixel
// height it needs. TARGET_ASPECT keeps each chunk's own height:width ratio near what the
// prototype used; it is a ratio, not a chunk count, so it scales with whatever the page's own
// aspect ratio turns out to be instead of hard-coding "5" for every receipt.
const TARGET_ASPECT = 1.5;
// Fraction of a slice's un-overlapped height shared with each neighbour, so a text line
// straddling a cut still lands wholly inside at least one slice.
const OVERLAP_FRACTION = 0.08;

/**
 * How to slice a `width`×`height` page image into overlapping horizontal chunks. A page whose own
 * aspect ratio is already at or under the target comes back as a single, unsliced chunk — most
 * inputs (including every existing test fixture) take this path untouched.
 */
export function planSlices(width: number, height: number): SlicePlan[] {
  if (width <= 0 || height <= 0) return [{ y0: 0, y1: Math.max(height, 0) }];
  const aspect = height / width;
  const n = Math.max(1, Math.ceil(aspect / TARGET_ASPECT));
  if (n === 1) return [{ y0: 0, y1: height }];
  const step = height / n;
  const overlap = step * OVERLAP_FRACTION;
  return Array.from({ length: n }, (_, i) => ({
    y0: Math.max(0, Math.round(i * step - overlap)),
    y1: Math.min(height, Math.round((i + 1) * step + overlap)),
  }));
}

/**
 * Crop one slice out of a page's pixmap. Uses mupdf's own `warp` (a quad-to-rectangle resample)
 * so no other image library is involved — the "render the crop region again" fallback the brief
 * allows isn't needed because warp crops an already-rendered pixmap directly.
 */
export function cropSlice(pix: mupdf.Pixmap, width: number, slice: SlicePlan): mupdf.Pixmap {
  const height = slice.y1 - slice.y0;
  const points: mupdf.Point[] = [
    [0, slice.y0],
    [width, slice.y0],
    [width, slice.y1],
    [0, slice.y1],
  ];
  return pix.warp(points, width, height);
}

type Fractional = { x: number; y: number; w: number; h: number };

/** Map one box recognised inside a slice back to a fraction of the whole page image. Slices span
 * the full page width, so only the y-axis needs remapping. */
export function mapBoxToPage<B extends Fractional>(box: B, slice: SlicePlan, pageHeight: number): B {
  const sliceHeight = slice.y1 - slice.y0;
  const yPx = slice.y0 + box.y * sliceHeight;
  return { ...box, y: yPx / pageHeight, h: (box.h * sliceHeight) / pageHeight };
}

// `source` identifies which slice a box came from (e.g. the chunk index); two boxes from the
// *same* slice are never candidates for dedupe — Vision does not detect one line twice inside a
// single image. `score`, when given, is used to pick which of two duplicate readings survives
// (higher wins); it exists because the two crops of a duplicated line are not pixel-identical —
// one copy sits nearer the middle of its slice than the other, and Vision reads text worse the
// closer it sits to a crop's cut edge, so the same *garbling* problem this whole slicing step
// exists to fix can also make one of two duplicate readings wrong. Without a score the first
// occurrence wins.
type Located = Fractional & { page: number; text: string; source: number; score?: number };

/**
 * Drop boxes that are a duplicate detection of one already kept — the same line of text read
 * twice because it fell inside the overlap between two neighbouring slices. Two boxes from
 * different slices of the same page, landing at essentially the same position, are treated as
 * one. Text is deliberately *not* part of the match: the two overlap reads of one line are not
 * always transcribed identically (that is exactly the kind of misread slicing exists to reduce,
 * not eliminate), so requiring equal text would let exactly the corrupted-duplicate case through.
 * Position doing the matching alone is safe here because a receipt is a single vertical column of
 * text — two genuinely different lines essentially never occupy near-identical bounding boxes.
 */
export function dedupeBoxes<B extends Located>(boxes: B[]): B[] {
  const kept: B[] = [];
  for (const b of boxes) {
    const dupIndex = kept.findIndex(k => isSameSpot(k, b));
    if (dupIndex === -1) {
      kept.push(b);
    } else if ((b.score ?? 0) > (kept[dupIndex].score ?? 0)) {
      kept[dupIndex] = b;
    }
  }
  return kept;
}

function isSameSpot(a: Located, b: Located): boolean {
  if (a.page !== b.page || a.source === b.source) return false;
  const aCenter = a.y + a.h / 2;
  const bCenter = b.y + b.h / 2;
  const verticalTolerance = Math.max(a.h, b.h, 0.002) * 0.6;
  if (Math.abs(aCenter - bCenter) > verticalTolerance) return false;
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const overlapWidth = Math.max(0, right - left);
  const minWidth = Math.min(a.w, b.w) || 1;
  return overlapWidth / minWidth > 0.5;
}
