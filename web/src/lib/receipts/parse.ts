import { parseAmountCents, parseQtyMilli } from "./money";
import type { Row } from "./rows";

export type DiscountLine = { label: string; tag: "M" | "A"; amountCents: number };
export type ParsedItem = {
  position: number;
  descPrinted: string;
  noPromo: boolean;
  sku: string | null;
  ean: string | null;
  qtyMilli: number;
  unit: "un" | "kg";
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  discounts: DiscountLine[];
};
export type ParsedHeader = {
  date: string | null; time: string | null;
  branchName: string | null; branchCode: string | null;
  fiscalNumber: string | null; register: string | null; terminal: string | null; trx: string | null;
  cuit: string | null; cae: string | null; caeDue: string | null;
  paymentMethod: string | null; paymentRef: string | null; paymentCents: number | null;
};
export type ParsedOffer = { label: string; amountCents: number | null };
export type ParsedFooter = {
  subtotalCents: number | null; discountsCents: number | null; totalCents: number | null;
  savingsCents: number | null; offers: ParsedOffer[];
};
export type ParsedReceipt = { header: ParsedHeader; items: ParsedItem[]; footer: ParsedFooter; notes: string[] };

// Line shapes, in the order the state machine tests them. Vision writes the multiplication sign
// as x, ×, or the Cyrillic х; the tag brackets come back as [A], LA], (M) and worse.
// The unit price's decimal comma gets the same period misread as any other amount ("2499.00"),
// hence [,.] there; the quantity's own comma never has (three decimals, no thousands).
const QTY_RE = /^(\d+,\d{3})\s*[xX×хХ]\s*(-?\d[\d.]*[,.]\d{2})$/;
// A stray period or comma sometimes lands between the two digit runs (noise bled in from
// nearby amount text).
export const CODE_RE = /^(\d{10})[.,]?\s+(\d{12,14})$/;
// The L/I readings of "[" only count after a space, or FRUTILLA and SANDIA would end in a tag.
// Up to two stray closing marks are tolerated after the letter ("[M)]" — a doubled bracket/paren
// misread) since a single one already was; widening `?` to `{0,2}` only ever costs an extra
// character of slop at the very end of the string, still anchored by the opening bracket/paren/
// pipe/L-I before the letter, so it can't start matching ordinary description text.
export const TAG_RE = /(?:\[|\(|\||\s[LI])\s*([AM])\s*[\])|J]{0,2}\s*$/;
// The two known discount-line shapes when the bracket tag is dropped entirely: "N *label" and
// "MERCADO PAGO...". Used both to recognise such a line and to know a page-boundary row is one.
const DISCOUNT_SHAPE_RE = /^(?:\d+\s*[x×хX]?\s*\*|MERCADO\s*PAGO)/i;
const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const FISCAL_RE = /NRO\.?\s*[TI1l]\.?\s*:?\s*(\d{4}-\d{8})/i;
const REGISTER_RE = /NRO[.,]?\s*CAJA\s*:?\s*(\d+)/i;
const TERMINAL_RE = /NRO[.,]?\s*TERM\s*:?\s*(\d+)/i;
const TRX_RE = /NRO[.,]?\s*TRAN\s*:?\s*(\d+)/i;
const BRANCH_RE = /^SUC\s+(\d+)\b/i;
const CUIT_RE = /CUIT\s*:?\s*(\d{2}-\d{8}-\d)/i;
const CAE_RE = /C\.?A\.?E\.?\s*N\S*\s*:?\s*(\d{14}).*?V\S*\s*:?\s*(\d{4})(\d{2})(\d{2})/i;
const PAYMENT_RE = /^(MERCADO PAG\w*)\s+(\d{6,})$/i;
const KG_RE = /X\s?KG\b|XKG|\bKGM\b/;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// The offers-section marker ("DETALLE DE OFERTAS APLICADAS") is read as badly as any other line
// on these scans, but unlike every other marker its OCR variants can't be listed — a third scan
// garbles it a third way. Recognised instead by normalised-similarity against the canonical text:
// uppercase, keep letters only (drops spaces, punctuation and the stray digits OCR sometimes
// injects), then a Levenshtein-based ratio. Threshold 0.7 was chosen against the two real garbled
// readings on file (ratio 0.76 and 0.885 — see parse.test.ts) and the one real near-miss text that
// must NOT match, "INGRESADOS EN EL DETALLE DE LA OPERACION" (ratio 0.235): the true readings sit
// well above 0.7, the false positive well below, and a false positive here is expensive (it stops
// item parsing and starts collecting offer pairs instead), so the threshold sits closer to the
// true positives' floor than to the false positive's ceiling.
const OFFERS_MARKER_CANON = normalizeForSimilarity("DETALLE DE OFERTAS APLICADAS");
const OFFERS_MARKER_THRESHOLD = 0.7;
function normalizeForSimilarity(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, "");
}
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1));
      prevDiag = temp;
    }
  }
  return dp[n];
}
function similarityRatio(label: string, canon: string): number {
  const candidate = normalizeForSimilarity(label);
  if (!candidate) return 0;
  const distance = levenshtein(candidate, canon);
  return 1 - distance / Math.max(candidate.length, canon.length);
}
function isOffersMarker(label: string): boolean {
  return similarityRatio(label, OFFERS_MARKER_CANON) >= OFFERS_MARKER_THRESHOLD;
}

// The "TOT.AHORRO" marker that closes the offers block gets the same OCR tolerance, for the same
// reason: its punctuation moves around ("TOT . AHORRO" — a space *before* the period, which the
// literal `/^TOT\.?\s*AHORRO/i` never anticipates) and a fresh scan can misplace it a new way.
// Letters-only normalisation collapses "TOT.AHORRO", "TOT . AHORRO" and "TOTAHORRO" to the same
// string, so the real reading scores 1.0; the closest thing on a real receipt that must NOT
// match is "TOTAL" (ratio 0.44 — see parse.test.ts), well under the 0.7 threshold shared with
// the offers marker above. A false positive here is just as expensive in the other direction: it
// closes the offers block early and starts reading ordinary footer rows as offer pairs.
const SAVINGS_MARKER_CANON = normalizeForSimilarity("TOT.AHORRO");
const SAVINGS_MARKER_THRESHOLD = 0.7;
function isSavingsMarker(label: string): boolean {
  return similarityRatio(label, SAVINGS_MARKER_CANON) >= SAVINGS_MARKER_THRESHOLD;
}

function emptyHeader(): ParsedHeader {
  return {
    date: null, time: null, branchName: null, branchCode: null, fiscalNumber: null, register: null,
    terminal: null, trx: null, cuit: null, cae: null, caeDue: null, paymentMethod: null,
    paymentRef: null, paymentCents: null,
  };
}

/** Header facts can sit on any row (the CAE is in the footer); the first reading wins. */
function scanHeader(label: string, h: ParsedHeader): void {
  const d = DATE_RE.exec(label);
  if (d && !h.date) { h.date = `${d[3]}-${d[2]}-${d[1]}`; h.time = `${d[4]}:${d[5]}:${d[6]}`; }
  const f = FISCAL_RE.exec(label);
  if (f && !h.fiscalNumber) h.fiscalNumber = f[1];
  const r = REGISTER_RE.exec(label);
  if (r && !h.register) h.register = r[1];
  const t = TERMINAL_RE.exec(label);
  if (t && !h.terminal) h.terminal = t[1];
  const x = TRX_RE.exec(label);
  if (x && !h.trx) h.trx = x[1];
  const b = BRANCH_RE.exec(label);
  if (b && !h.branchCode) { h.branchCode = b[1].padStart(3, "0"); h.branchName = label; }
  const c = CUIT_RE.exec(label);
  if (c && !h.cuit) h.cuit = c[1];
  const e = CAE_RE.exec(label);
  if (e && !h.cae) { h.cae = e[1]; h.caeDue = `${e[2]}-${e[3]}-${e[4]}`; }
}

// Box-grouping sometimes glues the code row to the description that follows it (a page-boundary
// artifact only, never seen mid-page): anchor on the code prefix and ignore what trails it.
// A round letter Vision sometimes substitutes for a "0" inside the sku/ean digit run (seen at a
// slice's own crop edge, where a "0"'s stroke goes thin enough to read as a similarly-round
// letter). Only the anchor used to detect a duplicated page tolerates this — codeOf() is never
// consulted for what actually gets stored, so a wrongly-read digit here can only ever help two
// duplicate copies of the same item recognise each other, never corrupt an item's real sku/ean.
const ANCHOR_DIGIT_RE = "[0-9OoCcQqDd]";
const CODE_ANCHOR_RE = new RegExp(`^(${ANCHOR_DIGIT_RE}{10})[.,]?\\s+(${ANCHOR_DIGIT_RE}{12,14})\\b`);
const normalizeAnchorDigits = (s: string) => s.replace(/[OoCcQqDd]/g, "0");
function codeOf(row: Row): { sku: string; ean: string } | null {
  const m = CODE_ANCHOR_RE.exec(norm(row.label));
  return m ? { sku: normalizeAnchorDigits(m[1]), ean: normalizeAnchorDigits(m[2]) } : null;
}

/**
 * Labels and amounts printed in "DETALLE DE OFERTAS APLICADAS" are collected in two separate
 * lists, in the order encountered, and paired by index afterwards — that is what survives the
 * row offset the scan introduces there (spec §5). Shared by parseRows (which reports the pairs)
 * and mergePages (which uses them only as a tiebreaker, never as a source of truth — see the
 * discount-dispute resolution below).
 */
function pairOffers(rows: Row[]): { labels: string[]; amounts: number[]; pairs: ParsedOffer[] } {
  const labels: string[] = [];
  const amounts: number[] = [];
  let inOffers = false;
  for (const row of rows) {
    const label = norm(row.label);
    if (isOffersMarker(label)) { inOffers = true; labels.length = 0; amounts.length = 0; continue; }
    if (!inOffers) continue;
    if (isSavingsMarker(label)) { inOffers = false; continue; }
    if (label) labels.push(label);
    const amount = row.amount === null ? null : parseAmountCents(row.amount);
    if (amount !== null) amounts.push(amount);
  }
  const pairs = labels.map((l, i) => ({ label: l, amountCents: amounts[i] ?? null }));
  return { labels, amounts, pairs };
}

/**
 * Reads a discount row the same way the parser's main loop eventually would: a tagged row's
 * label is whatever sits before the bracket, its amount forced negative; an untagged "N *label"
 * or "MERCADO PAGO..." row only counts when its own amount already reads negative. Returns null
 * for anything else (including a tagged row still waiting on a following bare-amount row — that
 * split-row shape isn't attempted here, only the common single-row discount line is).
 */
function discountFields(row: Row): { label: string; tag: "M" | "A"; amountCents: number } | null {
  const label = norm(row.label);
  const amountRaw = row.amount === null ? null : parseAmountCents(row.amount);
  const tagMatch = TAG_RE.exec(label);
  if (tagMatch) {
    if (amountRaw === null) return null;
    return {
      label: norm(label.slice(0, tagMatch.index)),
      tag: tagMatch[1] as "M" | "A",
      amountCents: amountRaw > 0 ? -amountRaw : amountRaw,
    };
  }
  if (DISCOUNT_SHAPE_RE.test(label) && amountRaw !== null && amountRaw < 0) {
    return { label, tag: /^MERCADO\s*PAGO/i.test(label) ? "M" : "A", amountCents: amountRaw };
  }
  return null;
}

/**
 * The scans overlap: page k+1 starts with lines already on page k. Code lines are the anchors —
 * every item has exactly one — so the longest run of codes that ends page k and starts page k+1
 * is the duplicated stretch. Each duplicated item is reconciled field by field rather than one
 * copy being kept wholesale: the line total is corroborated when qty × unit price confirms it
 * (see mergeDuplicateItem below); the discount amount has no such check, so it — like the
 * quantity line itself — comes from whichever copy's own quantity line parsed cleanly, or
 * (failing that signal on both sides) whichever copy carries more discount rows, since the page
 * break can fall between an item and its discounts, leaving them on one page only.
 *
 * One exception to "no arithmetic check can settle a disputed discount amount": when both copies
 * of a duplicated item's discount row agree on label and tag but disagree on the amount, and that
 * label is carried by exactly one discount row in the whole merged receipt, the printed
 * "DETALLE DE OFERTAS APLICADAS" total for that label — if exactly one of the two OCR readings
 * matches it — settles which reading was right. This never adopts a number OCR didn't already
 * read off the discount line itself, only chooses between the two readings already held; the
 * offers section is still never a source of truth (spec §2), and the exact-cent gate still has
 * final say. `notes` (optional; defaults to a throwaway array so existing callers are unaffected)
 * receives one line per resolved dispute.
 */
export function mergePages(rows: Row[], notes: string[] = []): Row[] {
  const offerPairs = pairOffers(rows).pairs;
  const offerAmountsByLabel = new Map<string, Set<number>>();
  for (const p of offerPairs) {
    if (p.amountCents === null || !p.label) continue;
    if (!offerAmountsByLabel.has(p.label)) offerAmountsByLabel.set(p.label, new Set());
    offerAmountsByLabel.get(p.label)!.add(p.amountCents);
  }
  // Only trust a label whose printed offer total is unambiguous (a repeated label with
  // disagreeing totals is a garbled footer, not evidence).
  const offerCentsByLabel = new Map<string, number>();
  for (const [label, amounts] of offerAmountsByLabel) if (amounts.size === 1) offerCentsByLabel.set(label, [...amounts][0]);

  const disputes: { row: Row; label: string; tag: "M" | "A"; chosenAmount: number; otherAmount: number }[] = [];

  const pageNumbers = [...new Set(rows.map(r => r.page))].sort((a, b) => a - b);
  const pages = pageNumbers.map(p => rows.filter(r => r.page === p));
  let merged: Row[] = pages[0] ?? [];
  for (const next of pages.slice(1)) {
    const a = merged.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const b = next.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const same = (p: { sku: string; ean: string }, q: { sku: string; ean: string }) =>
      p.sku === q.sku || p.ean === q.ean;
    // Requiring every position to match is brittle: one code garbled past codeOf()'s own anchor
    // tolerance (a stray character inside the digit run itself, not just a round-letter zero)
    // defeats the whole run, even though every other item in the stretch lines up. Tolerate up to
    // one interior mismatch, bounded three ways so a short coincidental run — most importantly,
    // a receipt that legitimately lists the same product twice — can't be mistaken for a real
    // page overlap: (1) the run must be at least MIN_RUN_LENGTH long, so the tolerance only ever
    // applies to a stretch with several other items already corroborating it; (2) at most
    // MAX_MISMATCHES position may disagree, keeping the mismatch ratio at or below 1 in 4 even at
    // the minimum length; (3) the run's own two endpoints (its first and last position) must
    // match cleanly — a run that is shaky right at the seam is exactly the case that must NOT
    // merge. A real duplicate purchase would have to coincidentally sit at the page boundary AND
    // have several neighbouring items also coincide on both sides for this to misfire, which a
    // genuine second purchase of one product elsewhere in the receipt never does.
    const MIN_RUN_LENGTH = 4;
    const MAX_MISMATCHES = 1;
    let k = 0;
    for (let n = Math.min(a.length, b.length); n >= 1; n--) {
      const tailA = a.slice(-n), headB = b.slice(0, n);
      const matches = tailA.map((x, j) => same(x.code!, headB[j].code!));
      const mismatchCount = matches.filter(m => !m).length;
      if (mismatchCount === 0) { k = n; break; } // exact match always wins outright
      if (n >= MIN_RUN_LENGTH && mismatchCount <= MAX_MISMATCHES && matches[0] && matches[n - 1]) {
        k = n;
        break;
      }
    }
    if (k === 0) { merged = merged.concat(next); continue; }

    // The untagged "N *label" shape is only trustworthy together with an already-negative amount
    // (mirrors the same guard on its main-loop counterpart below) — otherwise a garbled footer's
    // "N *label" offer lines would count as discounts here too.
    const isDiscount = (r: Row) => {
      const l = norm(r.label);
      if (TAG_RE.test(l)) return true;
      const amt = r.amount === null ? null : parseAmountCents(r.amount);
      return DISCOUNT_SHAPE_RE.test(l) && amt !== null && amt < 0;
    };
    const isTrailer = (r: Row) => isDiscount(r) || (r.label.trim() === "" && r.amount !== null);
    const trailerEnd = (rs: Row[], start: number, bound: number) => {
      let end = start;
      while (end < bound && isTrailer(rs[end])) end++;
      return end;
    };
    const parseQty = (r: Row | null) => {
      if (!r) return null;
      const m = QTY_RE.exec(norm(r.label));
      if (!m) return null;
      const q = parseQtyMilli(m[1]), u = parseLenientCents(m[2]);
      return q === null || u === null ? null : q * u;
    };
    const totalOf = (r: Row) => (r.amount === null ? null : parseAmountCents(r.amount));
    // A discount-shaped row that never got its amount (box-grouping put the amount on the wrong
    // row, or OCR mangled it past parsing) is broken evidence, not a discount that happened to be
    // read: count only rows whose amount actually parsed via discountFields, so a copy with a
    // bracketed-but-amountless discount label loses to a copy whose discount row carries its
    // amount clean, while a copy whose only advantage is an unparseable amount on the other side
    // still loses that comparison (0 either way falls through to the existing count).
    const discountCount = (rs: Row[]) => rs.filter(r => discountFields(r) !== null).length;

    const aAnchors = a.slice(a.length - k);
    const bAnchors = b.slice(0, k);
    let out: Row[] = [];
    let cursorA = 0;
    let lastTrailBEnd = 0;
    for (let j = 0; j < k; j++) {
      const codeIdxA = aAnchors[j].i, codeIdxB = bAnchors[j].i;
      const qtyIdxA = codeIdxA - 2, qtyIdxB = codeIdxB - 2;
      const qtyRowA = qtyIdxA >= 0 ? merged[qtyIdxA] : null;
      const qtyRowB = qtyIdxB >= 0 ? next[qtyIdxB] : null;
      const qtyCleanA = qtyRowA !== null && QTY_RE.test(norm(qtyRowA.label));
      const qtyCleanB = qtyRowB !== null && QTY_RE.test(norm(qtyRowB.label));

      const rowCodeA = merged[codeIdxA], rowCodeB = next[codeIdxB];

      // Quantity line: kept from page k too, except when that copy fails to parse as one at all
      // (a stray character breaks it) and page k+1's reads clean — or when both parse but
      // disagree (one digit misread in one copy: "0,396" against "0,336") and only page k+1's
      // qty × unit price reproduces a line total read on either copy's code row. The arithmetic
      // only ever chooses between the two readings already held, never invents a third.
      let headA = merged.slice(cursorA, codeIdxA);
      let qtyFromB = qtyIdxA >= 0 && qtyIdxB >= 0 && !qtyCleanA && qtyCleanB;
      if (qtyIdxA >= 0 && qtyIdxB >= 0 && qtyCleanA && qtyCleanB) {
        const expectA = parseQty(qtyRowA), expectB = parseQty(qtyRowB);
        if (expectA !== null && expectB !== null && expectA !== expectB) {
          const totals = [totalOf(rowCodeA), totalOf(rowCodeB)].filter((t): t is number => t !== null);
          const fits = (e: number) => totals.some(t => Math.abs(t - Math.round(e / 1000)) <= 1);
          if (!fits(expectA) && fits(expectB)) qtyFromB = true;
        }
      }
      if (qtyFromB) headA = headA.map((r, off) => (cursorA + off === qtyIdxA ? qtyRowB! : r));
      const qtyRowKept = qtyFromB ? qtyRowB : qtyRowA;
      // Discount and code-row-cleanliness share one "which copy" decision, since the discount
      // row's own shape can depend on whether its item's code row carried an amount (see the
      // pendingDiscount/pendingDiscountAmount machinery) — mixing a code row from one copy with
      // a trailer from the other would break that coupling. No arithmetic check applies to the
      // discount itself, so the choice comes from whichever copy's own quantity line parsed
      // cleanly — but only when both copies actually have a quantity line to compare; when the
      // page break instead cut one copy off before (or after) its own quantity line entirely,
      // that absence says nothing about which copy's discount rows survived, so fall back to
      // whichever copy carries more of them (the page break can fall between an item and its
      // discounts, leaving them on one page only).
      const boundA = j + 1 < k ? aAnchors[j + 1].i : merged.length;
      const boundB = j + 1 < k ? bAnchors[j + 1].i : next.length;
      const trailAEnd = trailerEnd(merged, codeIdxA + 1, boundA);
      const trailBEnd = trailerEnd(next, codeIdxB + 1, boundB);
      const trailA = merged.slice(codeIdxA + 1, trailAEnd);
      const trailB = next.slice(codeIdxB + 1, trailBEnd);
      const preferB = qtyRowA !== null && qtyRowB !== null && qtyCleanA !== qtyCleanB
        ? qtyCleanB
        : discountCount(trailB) > discountCount(trailA);
      const keptTrail = preferB ? trailB : trailA;
      const chosenCodeRow = preferB ? rowCodeB : rowCodeA;
      const otherCodeRow = preferB ? rowCodeA : rowCodeB;

      // Record a dispute for every discount row the two copies read the same label/tag on but a
      // different amount for. The whole trailer is chosen from one copy above (preferB), so at
      // most one of the two rows in a matched pair actually survives into the output — hold a
      // reference to that one so the resolution sweep below can replace just its amount in place.
      const discFieldsA = trailA
        .map(row => ({ row, f: discountFields(row) }))
        .filter((x): x is { row: Row; f: NonNullable<ReturnType<typeof discountFields>> } => x.f !== null);
      const discFieldsB = trailB
        .map(row => ({ row, f: discountFields(row) }))
        .filter((x): x is { row: Row; f: NonNullable<ReturnType<typeof discountFields>> } => x.f !== null);
      for (const dA of discFieldsA) {
        const dB = discFieldsB.find(x => x.f.label === dA.f.label && x.f.tag === dA.f.tag && x.f.amountCents !== dA.f.amountCents);
        if (!dB) continue;
        disputes.push({
          row: preferB ? dB.row : dA.row,
          label: dA.f.label,
          tag: dA.f.tag,
          chosenAmount: preferB ? dB.f.amountCents : dA.f.amountCents,
          otherAmount: preferB ? dA.f.amountCents : dB.f.amountCents,
        });
      }

      // Line total: corroborated by qty × unit price. Only overridden when the chosen copy's own
      // code row carries an amount that the arithmetic refutes AND the other copy's own code row
      // carries one it confirms — swapping in just that number, never the row structure, so the
      // kept trailer (still the chosen copy's) stays consistent with its own code row having (or
      // lacking) an amount.
      const expect = parseQty(qtyRowKept) ?? parseQty(qtyRowA) ?? parseQty(qtyRowB);
      let codeRow = chosenCodeRow;
      const chosenTotal = totalOf(chosenCodeRow), otherTotal = totalOf(otherCodeRow);
      if (expect !== null && chosenTotal !== null && otherTotal !== null) {
        const roundedExpect = Math.round(expect / 1000);
        const chosenMatches = Math.abs(chosenTotal - roundedExpect) <= 1;
        const otherMatches = Math.abs(otherTotal - roundedExpect) <= 1;
        if (!chosenMatches && otherMatches) codeRow = { ...chosenCodeRow, amount: otherCodeRow.amount };
      }
      // Independent of arithmetic: the chosen copy's own code text is the mangled one (extra
      // glued text breaks the exact code shape) and the other copy's reads clean.
      if (codeRow === chosenCodeRow && !CODE_RE.test(norm(chosenCodeRow.label)) && CODE_RE.test(norm(otherCodeRow.label))) {
        codeRow = otherCodeRow;
      }

      out = out.concat(headA, [codeRow], keptTrail);
      cursorA = trailAEnd;
      lastTrailBEnd = trailBEnd;
    }
    merged = out.concat(next.slice(lastTrailBEnd));
  }

  if (disputes.length > 0) {
    // Condition 2 needs a count over the merged result, so it can only be resolved once merging
    // (across every page pair) is done.
    const finalLabelCounts = new Map<string, number>();
    for (const row of merged) {
      const f = discountFields(row);
      if (f) finalLabelCounts.set(f.label, (finalLabelCounts.get(f.label) ?? 0) + 1);
    }
    for (const d of disputes) {
      if ((finalLabelCounts.get(d.label) ?? 0) !== 1) continue; // attribution ambiguous
      const offerCents = offerCentsByLabel.get(d.label);
      if (offerCents === undefined) continue; // no unambiguous offer total for this label
      const chosenMatches = Math.abs(d.chosenAmount) === offerCents;
      const otherMatches = Math.abs(d.otherAmount) === offerCents;
      if (chosenMatches === otherMatches) continue; // neither, or both (uninformative) — garbled offers row
      const winner = chosenMatches ? d.chosenAmount : d.otherAmount;
      const loser = chosenMatches ? d.otherAmount : d.chosenAmount;
      if (winner !== d.chosenAmount) {
        merged = merged.map(row => (row === d.row ? { ...row, amount: centsToAmountString(winner) } : row));
      }
      notes.push(
        `discount "${d.label}" [${d.tag}]: two OCR readings disagreed (${centsToAmountString(d.chosenAmount)} vs ` +
        `${centsToAmountString(d.otherAmount)}); the offers section total settled on ${centsToAmountString(winner)}` +
        (winner === d.chosenAmount ? "" : `, over the proxy's own pick of ${centsToAmountString(loser)}`),
      );
    }
  }

  return merged;
}

// Vision only treats a box as an amount when it reads the printed decimal comma; when it misreads
// that comma as a period the box-grouping step doesn't recognise it as one, so it stays glued
// (space-joined) to whatever text box sits on the same printed line instead of splitting off —
// whether that is a code+ean, a footer marker like TOTAL, or nothing at all (the row is only
// the amount).
const TRAILING_PERIOD_AMOUNT_RE = /^(.*?)\s+(-?\d[\d.,]*\.\d{2})$/;
function parseLenientCents(raw: string): number | null {
  const m = /^(-?)(\d+(?:[.,]\d{3})*)[.,](\d{2})$/.exec(raw.replace(/\s+/g, ""));
  if (!m) return null;
  const cents = Number(m[2].replace(/[.,]/g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}
function centsToAmountString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${(Math.abs(cents) / 100).toFixed(2).replace(".", ",")}`;
}
function ungluePeriodAmounts(rows: Row[]): Row[] {
  return rows.map(row => {
    if (row.amount !== null) return row;
    // A quantity line's unit price is not a line amount, whichever way its decimal was read.
    if (QTY_RE.test(norm(row.label))) return row;
    const trimmed = row.label.trim();
    if (!/\s/.test(trimmed) && /\.\d{2}$/.test(trimmed)) {
      const cents = parseLenientCents(trimmed);
      if (cents !== null) return { ...row, label: "", amount: centsToAmountString(cents) };
    }
    const m = TRAILING_PERIOD_AMOUNT_RE.exec(row.label);
    if (!m) return row;
    const cents = parseLenientCents(m[2]);
    if (cents === null) return row;
    return { ...row, label: m[1].trim(), amount: centsToAmountString(cents) };
  });
}

// Defect: box-grouping sometimes pulls the AMOUNT box of the line that follows a quantity line
// into the quantity line's own row (the two sit close enough vertically for the row-grouping
// tolerance to treat them as one). A quantity line never prints its own amount — spec §5's shape
// is just "qty x unit_price" — so any amount attached to a QTY_RE-shaped row is always spillover
// that belongs to the very next row, and only ever the next row (the one immediately below it,
// same page), never further down. Move it there, but only when that row doesn't already carry an
// amount of its own — a row that already has one read its amount correctly and the spillover is
// simply lost box noise, not a second figure to overwrite it with.
function unglueQtyAmount(rows: Row[]): Row[] {
  const out = rows.map(r => ({ ...r }));
  for (let i = 0; i < out.length - 1; i++) {
    const row = out[i];
    if (row.amount === null || !QTY_RE.test(norm(row.label))) continue;
    const next = out[i + 1];
    if (next.page !== row.page || next.amount !== null) continue;
    out[i + 1] = { ...next, amount: row.amount };
    out[i] = { ...row, amount: null };
  }
  return out;
}

// Defect: Vision occasionally reads one printed code+ean line as two boxes that duplicate each
// other, so box-grouping glues the SAME "<code> <ean>" text to itself ("<code> <ean> <code>
// <ean>"). CODE_RE's `$` anchor then fails just like it does for defects D, E and F below.
// General, not receipt-specific: collapse any row whose entire label is the same code+ean anchor
// match repeated twice in a row into the single clean reading.
function dedupeSelfRepeatedCode(rows: Row[]): Row[] {
  return rows.map(row => {
    const label = norm(row.label);
    if (CODE_RE.test(label)) return row;
    const m = CODE_INLINE_RE.exec(label);
    if (!m || m.index !== 0) return row;
    const first = `${m[1]} ${m[2]}`;
    const rest = norm(label.slice(m[0].length));
    if (rest !== first) return row;
    return { ...row, label: first };
  });
}

// Anchors a code+ean pair anywhere in a row's label (not just a full-row match like CODE_RE), so
// a glued neighbour can be found and split off on either side. Digits only — unlike
// CODE_ANCHOR_RE above, this is used to build the sku/ean that actually gets stored, so it must
// not tolerate the round-letter-for-zero substitution that anchor is allowed to.
const CODE_INLINE_RE = /(\d{10})[.,]?\s+(\d{12,14})/;

// A quantity line whose thousandths carry exactly one non-digit (Vision swapped one digit for a
// look-alike letter: "0,3Е8" with a Cyrillic Е for the 8). The unit price still reads clean. The
// missing digit is settled by arithmetic against the item's line total once the item is complete
// (see reconcileArithmetic) — never guessed.
const QTY_GARBLED_RE = /^(\d+),([\d\D]{3})\s*[xX×хХ]\s*(-?\d[\d.]*[,.]\d{2})$/u;
function garbledQtyPattern(label: string): { pattern: string; unitPriceCents: number } | null {
  const m = QTY_GARBLED_RE.exec(label);
  if (!m) return null;
  const milli = m[2];
  const bad = [...milli].filter(c => !/\d/.test(c));
  if (bad.length !== 1 || /\s/.test(milli)) return null;
  const u = parseLenientCents(m[3]);
  if (u === null) return null;
  return { pattern: m[1] + "," + [...milli].map(c => (/\d/.test(c) ? c : "?")).join(""), unitPriceCents: u };
}

// A GTIN (EAN-13 / GTIN-14) ends in a mod-10 check digit, so one character Vision garbled inside
// the digit run ("07/90070335944" — a slash for the 7 the print smudged) has exactly one digit
// that makes the check work out: the weight of every position is 1 or 3, both invertible mod 10.
// Only a single garbled character is ever repaired; two unknowns would leave ten solutions.
const EAN_GARBLED_RE = /^(\d{10})[.,]?\s+(\S{12,14})(?=\s|$)/;
export function repairGtin(raw: string): string | null {
  const bad = [...raw].map((c, i) => (/\d/.test(c) ? -1 : i)).filter(i => i >= 0);
  if (bad.length !== 1 || raw.length < 12 || raw.length > 14) return null;
  const at = bad[0];
  let sum = 0, weightAt = 0;
  for (let i = 0; i < raw.length; i++) {
    const fromRight = raw.length - 1 - i; // check digit is at fromRight 0 (weight 1), then 3,1,3...
    const weight = fromRight % 2 === 0 ? 1 : 3;
    if (i === at) weightAt = weight; else sum += Number(raw[i]) * weight;
  }
  for (let d = 0; d <= 9; d++) if ((sum + d * weightAt) % 10 === 0) return raw.slice(0, at) + d + raw.slice(at + 1);
  return null;
}
function repairCodeEan(rows: Row[], notes: string[]): Row[] {
  return rows.map(row => {
    const label = norm(row.label);
    if (CODE_RE.test(label)) return row;
    const m = EAN_GARBLED_RE.exec(label);
    if (!m || /^\d+$/.test(m[2])) return row;
    const fixed = repairGtin(m[2]);
    if (fixed === null) return row;
    notes.push(`ean "${m[2]}" read with one garbled character; check digit settles it as ${fixed}`);
    return { ...row, label: `${m[1]} ${fixed}${label.slice(m[0].length)}` };
  });
}

// Defect D: box-grouping glues a code row to the discount tag (and its amount, already split
// into row.amount by boxesToRows) that follows it on the next printed line: "<code> <ean> [A]"
// with the row's own amount already negative. CODE_RE's `$` anchor then matches nothing and no
// item gets built at all — worse, the still-open *previous* item is still `current`, so the
// discount below (via TAG_RE) silently attaches to it instead (see FINDINGS defect D). Anchor on
// the code prefix, as ungluePeriodAmounts and codeOf() do, and require the entire glued tail to
// be nothing but the tag — never text, so this can't be confused with a glued description
// (defect E, handled separately, and run after this one for that reason).
//
// A printed line total is never negative (the same invariant unglueCodeDescription checks in the
// other direction), so once the code anchors the row's start and its own amount already reads
// negative, the glued tail can only ever be the discount's bracket tag — never a description,
// regardless of what OCR made of the bracket itself. TAG_RE recognises the usual bracket shapes
// directly; when even the opening bracket is misread into some other letter ("CA]" for "[A]", the
// discount label's own row is never glued here — only its tag is, so the tail is short), fall
// back to whichever of A/M the remnant actually contains. Never both: a genuine tag remnant only
// ever carries one of the two letters, so an ambiguous tail (both, or neither) is left unsplit
// rather than guessed at.
function unglueCodeTag(rows: Row[]): Row[] {
  return rows.flatMap(row => {
    const label = norm(row.label);
    if (CODE_RE.test(label) || row.amount === null) return [row];
    const amount = parseAmountCents(row.amount);
    if (amount === null || amount >= 0) return [row]; // a printed line total is never negative
    const m = CODE_INLINE_RE.exec(label);
    if (!m || m.index !== 0) return [row]; // the code must anchor the start of the row
    const tail = norm(label.slice(m[0].length));
    if (!tail) return [row];
    const direct = TAG_RE.exec(tail);
    let tagTail = direct ? tail : null;
    if (!direct) {
      const hasA = /A/.test(tail), hasM = /M/.test(tail);
      if (hasA !== hasM) tagTail = `[${hasA ? "A" : "M"}]`;
    }
    if (tagTail === null) return [row];
    return [
      { ...row, label: `${m[1]} ${m[2]}`, amount: null },
      { ...row, label: tagTail, amount: row.amount },
    ];
  });
}

// Defect E: box-grouping glues a code row to the item's own description, on either side —
// "CIF 0000574549 07791290795600" or "0000574543 07791290795587 CIF". Same cause as defect D,
// different neighbour: CODE_RE's anchors match neither shape, so no item gets built. Find the
// code anchor anywhere in the row, and if there is exactly one non-empty neighbour (before or
// after) that isn't itself a discount shape (defect D's territory — run this pass after
// unglueCodeTag so a tag never reaches here), split it into two rows in printed order: the
// description first, then the bare code row — the state machine takes an item's description from
// the last unclassified label row above its code line, so the description must sit above it
// regardless of which side of the glued text it started on. The row's own amount (usually the
// line total) stays on the code row, matching the shape the state machine already handles.
function unglueCodeDescription(rows: Row[]): Row[] {
  return rows.flatMap(row => {
    const label = norm(row.label);
    if (CODE_RE.test(label)) return [row];
    // Defect E's shape is specifically a clean amount box that Vision already split off
    // correctly, with only the description text leaking into the label — never a negative
    // amount (a printed line total is never negative, the same invariant unglueCodeTag checks;
    // a negative amount glued here is the pendingDiscountAmount shape instead, however badly its
    // own tag got misread) and never a row with no amount box of its own at all (that shape is
    // usually a garbled amount still embedded as text, which ungluePeriodAmounts is the one
    // built to recover — grabbing it here first would bury it inside a bogus description).
    if (row.amount === null) return [row];
    const amount = parseAmountCents(row.amount);
    if (amount === null || amount < 0) return [row];
    const m = CODE_INLINE_RE.exec(label);
    if (!m) return [row];
    const before = label.slice(0, m.index).trim();
    const after = label.slice(m.index + m[0].length).trim();
    if (before && after) return [row]; // neighbours on both sides — not this defect's shape
    const desc = before || after;
    // A neighbour with no letters at all is never a description (every printed description has
    // letters in it) — likely leftover digit noise from a misread code.
    if (!desc || TAG_RE.test(desc) || DISCOUNT_SHAPE_RE.test(desc) || !/[A-Za-zÀ-ÿ]/.test(desc)) return [row];
    return [
      { ...row, label: desc, amount: null },
      { ...row, label: `${m[1]} ${m[2]}`, amount: row.amount },
    ];
  });
}

// Defect F: box-grouping glues a description row to the quantity line that belongs above it —
// "CREMA DE LECHE MILKAUT DOBLEPOT 200 CC 2,000 x 3670,00" — because the two boxes' text got
// sorted left-to-right into one row despite sitting on separate printed lines (the quantity box
// often lands further right). QTY_RE's anchors then match neither the glued row nor anything
// else, so the item is born with qty 1000 and no unit price. Recognised by a QTY_RE-shaped tail;
// split into two rows in *printed* (not glued-text) order — the quantity line above the
// description, exactly as the clean shape elsewhere in this file and in spec §5 — since the main
// loop clears `candidate` on every quantity line (it is only ever meant to precede a
// description), so emitting the description first would silently drop it.
const QTY_TAIL_RE = /^(.*\S)\s+(\d+,\d{3}\s*[xX×хХ]\s*-?\d[\d.]*[,.]\d{2})$/;
function unglueQtyLine(rows: Row[]): Row[] {
  return rows.flatMap(row => {
    const label = norm(row.label);
    if (QTY_RE.test(label)) return [row];
    const m = QTY_TAIL_RE.exec(label);
    if (!m) return [row];
    return [
      { ...row, label: m[2], amount: null },
      { ...row, label: m[1], amount: row.amount },
    ];
  });
}

// A row whose box-grouping left it with no label at all: the whole row is just an amount. Only
// positive, since this is used to recognise a stray printed subtotal — never negative — and a
// bare negative amount directly above a footer marker is routinely just the previous item's
// discount landing on its own row (see the pendingDiscount/pendingDiscountAmount machinery).
function barePositiveAmountOf(r: Row): number | null {
  if (norm(r.label)) return null;
  const amount = r.amount === null ? null : parseAmountCents(r.amount);
  return amount !== null && amount > 0 ? amount : null;
}

const digitsOf = (n: number) => String(n);
/** The quantities (in thousandths) one digit away from `pattern` ("0,3?8" → 0,308…0,398; "0,396" →
 * every single-digit substitution) whose product with the unit price lands on the line total. */
function qtyCandidates(pattern: string, unitPriceCents: number, totalCents: number): number[] {
  const fits = (q: number) => Math.abs(Math.round((q * unitPriceCents) / 1000) - totalCents) <= 1;
  const variants: string[] = [];
  if (pattern.includes("?")) {
    for (let d = 0; d <= 9; d++) variants.push(pattern.replace("?", String(d)));
  } else {
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === ",") continue;
      for (let d = 0; d <= 9; d++) if (String(d) !== pattern[i]) variants.push(pattern.slice(0, i) + d + pattern.slice(i + 1));
    }
  }
  return [...new Set(variants.map(v => parseQtyMilli(v)).filter((q): q is number => q !== null && q > 0 && fits(q)))];
}

/**
 * Every printed line total is qty × unit price (to the cent, with at most a one-cent rounding on a
 * weighed item), and on this printer the three numbers sit on two adjacent lines — so when they
 * disagree, one of them was misread. Only two repairs are ever made, both bounded to a single
 * digit and both settled by the other two numbers rather than guessed: (1) the line total is one
 * character away from qty × unit price ("1340,00" for 7340,00) — take the product; (2) the
 * quantity, one digit substituted (or the one Vision garbled outright, see QTY_GARBLED_RE), is the
 * *only* such quantity that reproduces the line total — take it. A quantity that several
 * substitutions could explain, or a total more than one character off, is left alone for the
 * exact-cent gate to reject and the user to correct. Each repair leaves a note.
 */
function reconcileArithmetic(items: ParsedItem[], garbledQty: Map<ParsedItem, string>, notes: string[]): void {
  for (const it of items) {
    if (it.unitPriceCents === null || it.lineTotalCents === null) continue;
    const pattern = garbledQty.get(it);
    if (pattern) {
      const qs = qtyCandidates(pattern, it.unitPriceCents, it.lineTotalCents);
      if (qs.length === 1) {
        it.qtyMilli = qs[0];
        it.unit = qs[0] % 1000 !== 0 || KG_RE.test(it.descPrinted) ? "kg" : "un";
        notes.push(`item ${it.position} (${it.descPrinted}): quantity read as "${pattern}"; the line total settles it as ${(qs[0] / 1000).toFixed(3).replace(".", ",")}`);
      } else {
        it.unitPriceCents = null;
        notes.push(`unreadable quantity line "${pattern}" on item ${it.position} (${it.descPrinted})`);
      }
      continue;
    }
    const expected = Math.round((it.qtyMilli * it.unitPriceCents) / 1000);
    if (Math.abs(expected - it.lineTotalCents) <= 1) continue;
    const got = digitsOf(it.lineTotalCents), want = digitsOf(expected);
    const differing = got.length === want.length ? [...got].filter((c, i) => c !== want[i]).length : -1;
    if (differing === 1) {
      notes.push(`item ${it.position} (${it.descPrinted}): line total read as ${centsToAmountString(it.lineTotalCents)}; qty × unit price says ${centsToAmountString(expected)}`);
      it.lineTotalCents = expected;
      continue;
    }
    const qtyText = `${Math.floor(it.qtyMilli / 1000)},${String(it.qtyMilli % 1000).padStart(3, "0")}`;
    const qs = qtyCandidates(qtyText, it.unitPriceCents, it.lineTotalCents);
    if (qs.length === 1) {
      notes.push(`item ${it.position} (${it.descPrinted}): quantity read as ${qtyText}; the line total settles it as ${(qs[0] / 1000).toFixed(3).replace(".", ",")}`);
      it.qtyMilli = qs[0];
      it.unit = qs[0] % 1000 !== 0 || KG_RE.test(it.descPrinted) ? "kg" : "un";
    }
  }
}

/**
 * One pass over the rows. An item is born at its code line, takes the label row just above it
 * as its description and the quantity line above that (if any) as its quantity, and then owns
 * every discount row until the next quantity line, code line or footer marker.
 */
export function parseRows(input: Row[]): ParsedReceipt {
  const notes: string[] = [];
  // Glue-splitters run before mergePages, so its own code anchoring (already tolerant of a glued
  // trailer — see codeOf()) sees clean code rows too, and before the state machine for the reason
  // each is commented with above. Order among them matters: ungluePeriodAmounts runs first so a
  // triple-glued row (code + description + a period-decimal amount, all one row — see defect E
  // composed with the period-amount defect) has its amount recognised before unglueCodeDescription
  // ever sees the row, the same way it already does for a plain code+amount row; unglueQtyAmount
  // must also run before the code-row splitters, so a quantity line's stray amount lands on the
  // very row those splitters are about to act on rather than staying stranded; dedupeSelfRepeatedCode
  // is independent (it only ever touches a row CODE_RE already rejects) so its position doesn't
  // matter beyond running before unglueCodeDescription would otherwise treat the repeat as a glued
  // description. unglueCodeTag must run before unglueCodeDescription, since a still-glued tag would
  // otherwise be mistaken for a glued description; unglueQtyLine is independent of the code-row
  // splitters (it never touches a code line) so its position relative to them doesn't matter, but
  // it must run before mergePages can see a clean quantity line for its own duplicate-page
  // reconciliation.
  const preSplit = unglueCodeDescription(unglueCodeTag(unglueQtyLine(
    dedupeSelfRepeatedCode(unglueQtyAmount(ungluePeriodAmounts(repairCodeEan(input, notes)))))));
  const rows = mergePages(preSplit, notes);
  const header = emptyHeader();
  const footer: ParsedFooter = { subtotalCents: null, discountsCents: null, totalCents: null, savingsCents: null, offers: [] };
  const items: ParsedItem[] = [];
  let pending: { qtyMilli: number; unitPriceCents: number; qtyPattern?: string } | null = null;
  const garbledQty = new Map<ParsedItem, string>(); // item → "0,3?8": settled by arithmetic below
  let candidate: Row | null = null;     // the last unclassified label row: the next description
  let current: ParsedItem | null = null; // the item still accepting a line total and discounts
  // A discount label read before the item's own line total: its amount box landed on the line
  // total instead, and the discount's real amount follows as a bare row. Waits for that row.
  let pendingDiscount: { label: string; tag: "M" | "A" } | null = null;
  // The mirror image: a discount's amount read before its own label — box-grouping put it on the
  // item's code row, excluded from the line total there because a printed line total is never
  // negative (see below). Waits for the label that follows.
  let pendingDiscountAmount: number | null = null;
  let awaitingTotal = false;     // TOTAL printed with its amount on the next row instead of this one
  let awaitingSubtotal = false;  // same, for SUBTOT. SIN DESCUENTOS
  let awaitingDescuentos = false; // same, for DESCUENTOS POR PROMOCIONES
  let inOffers = false;
  // A printed discount total (DESCUENTOS POR PROMOCIONES) is always a subtraction, so it prints
  // negative; OCR sometimes drops the minus sign when the row gets glued to something else.
  const forceNegative = (n: number) => (n > 0 ? -n : n);

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const label = norm(row.label);
    const amount = row.amount === null ? null : parseAmountCents(row.amount);
    if (row.amount !== null && amount === null) notes.push(`unreadable amount "${row.amount}" next to "${label}"`);
    scanHeader(label, header);

    if (isOffersMarker(label)) {
      inOffers = true; current = null; candidate = null;
      continue;
    }
    if (inOffers) {
      if (isSavingsMarker(label)) { inOffers = false; footer.savingsCents = amount; continue; }
      continue;
    }
    if (/^SUBTOT/i.test(label)) {
      // Box-grouping sometimes shifts every footer amount one row early: the true subtotal
      // prints as a lone amount on the row right above this marker, and this row's own amount
      // box is actually the DESCUENTOS figure that follows (whose own marker row then reads
      // with no amount of its own, sometimes too garbled by OCR to even match its own label).
      // Recognised by a combination that never happens on a cleanly-read footer: a bare amount
      // immediately above AND this marker still carrying an amount of its own.
      const prevBare = idx > 0 ? barePositiveAmountOf(rows[idx - 1]) : null;
      if (amount !== null && prevBare !== null) {
        footer.subtotalCents = prevBare;
        footer.discountsCents = forceNegative(amount);
      } else if (amount !== null) {
        footer.subtotalCents = amount;
      } else {
        awaitingSubtotal = true;
      }
      current = null; candidate = null; pendingDiscount = null; pendingDiscountAmount = null;
      continue;
    }
    if (/^DESCUENTOS POR PROMOCIONES/i.test(label)) {
      if (amount !== null) footer.discountsCents = forceNegative(amount);
      else awaitingDescuentos = true;
      continue;
    }
    if (/^TOTAL\.?$/i.test(label)) {
      if (amount !== null) footer.totalCents = amount; else awaitingTotal = true;
      continue;
    }
    const pay = PAYMENT_RE.exec(label);
    if (pay) { header.paymentMethod = pay[1].toUpperCase(); header.paymentRef = pay[2]; header.paymentCents = amount; continue; }

    const qty = QTY_RE.exec(label);
    if (qty) {
      const q = parseQtyMilli(qty[1]);
      const u = parseLenientCents(qty[2]);
      if (q === null || u === null) notes.push(`unreadable quantity line "${label}"`);
      else pending = { qtyMilli: q, unitPriceCents: u };
      current = null; candidate = null; pendingDiscount = null; pendingDiscountAmount = null;
      continue;
    }
    const garbled = garbledQtyPattern(label);
    if (garbled) {
      pending = { qtyMilli: 1000, unitPriceCents: garbled.unitPriceCents, qtyPattern: garbled.pattern };
      current = null; candidate = null; pendingDiscount = null; pendingDiscountAmount = null;
      continue;
    }

    const code = CODE_RE.exec(label);
    if (code) {
      if (!candidate) notes.push(`code line ${code[1]} has no description above it`);
      if (pendingDiscount) notes.push(`discount "${pendingDiscount.label}" never got its amount`);
      if (pendingDiscountAmount !== null) notes.push(`stray amount ${centsToAmountString(pendingDiscountAmount)}`);
      const desc = candidate ? norm(candidate.label) : "";
      const marker = /^[=\-−]/.test(desc);
      const descPrinted = marker ? "=" + desc.slice(1).trimStart() : desc;
      const fromCandidate = candidate?.amount == null ? null : parseAmountCents(candidate.amount);
      const qtyMilli = pending?.qtyMilli ?? 1000;
      // A printed line total is never negative. Box-grouping sometimes puts the following
      // discount's amount on the code row instead of the item's own total (which then sits on
      // the description row above, already read into fromCandidate) — exclude a negative amount
      // here and hold it for the discount label that follows instead of taking it as the total.
      current = {
        position: items.length + 1,
        descPrinted, noPromo: marker, sku: code[1], ean: code[2], qtyMilli,
        unit: qtyMilli % 1000 !== 0 || KG_RE.test(descPrinted) ? "kg" : "un",
        unitPriceCents: pending?.unitPriceCents ?? null,
        lineTotalCents: amount !== null && amount >= 0 ? amount : fromCandidate,
        discounts: [],
      };
      items.push(current);
      if (pending?.qtyPattern) garbledQty.set(current, pending.qtyPattern);
      pending = null; candidate = null; pendingDiscount = null;
      pendingDiscountAmount = amount !== null && amount < 0 ? amount : null;
      continue;
    }

    const tag = TAG_RE.exec(label);
    const untaggedDiscount = !tag && DISCOUNT_SHAPE_RE.test(label);
    if ((tag || untaggedDiscount) && amount === null && pendingDiscountAmount !== null && current) {
      // The item's code row carried this discount's amount, excluded above because a line total
      // is never negative; its label follows here with none of its own. Reunite them.
      const lbl = tag ? norm(label.slice(0, tag.index)) : label;
      const inferredTag: "M" | "A" = tag ? (tag[1] as "M" | "A") : (/^MERCADO\s*PAGO/i.test(label) ? "M" : "A");
      current.discounts.push({ label: lbl, tag: inferredTag, amountCents: pendingDiscountAmount });
      pendingDiscountAmount = null;
      continue;
    }

    if (tag) {
      const tagged = { label: norm(label.slice(0, tag.index)), tag: tag[1] as "M" | "A" };
      // Box-grouping sometimes splits the discount label from its amount, leaving this row bare
      // and the amount on the row that follows: wait for it instead of dropping the line.
      if (amount === null) {
        if (current) pendingDiscount = tagged;
        else notes.push(`discount "${label}" has no item to attach to`);
        continue;
      }
      // Normally the discount row carries its own (already negative) amount. But box-grouping
      // sometimes puts the item's line total on this row instead, ahead of a bare amount row
      // that then carries the real discount — recognisable by the open line total together with
      // a positive amount here (a real discount is always printed negative already).
      if (current && current.lineTotalCents === null && amount > 0) {
        current.lineTotalCents = amount;
        pendingDiscount = tagged;
        continue;
      }
      const discount: DiscountLine = { ...tagged, amountCents: amount > 0 ? -amount : amount };
      if (current) current.discounts.push(discount);
      else notes.push(`discount "${label}" has no item to attach to`);
      continue;
    }

    // The bracket tag is occasionally dropped from OCR entirely, leaving no [A]/[M] at all. The
    // "N *label" / "MERCADO PAGO..." shape together with an already-negative amount is still
    // enough to recognise the line and infer which of the two tags it is.
    if (current && amount !== null && amount < 0 && DISCOUNT_SHAPE_RE.test(label)) {
      const tag = /^MERCADO\s*PAGO/i.test(label) ? "M" : "A";
      current.discounts.push({ label, tag, amountCents: amount });
      continue;
    }

    if (!label && amount !== null) {
      if (awaitingTotal) { footer.totalCents = amount; awaitingTotal = false; }
      else if (awaitingSubtotal) { footer.subtotalCents = amount; awaitingSubtotal = false; }
      else if (awaitingDescuentos) { footer.discountsCents = forceNegative(amount); awaitingDescuentos = false; }
      else if (current && pendingDiscount) {
        current.discounts.push({ ...pendingDiscount, amountCents: amount > 0 ? -amount : amount });
        pendingDiscount = null;
      } else if (current && current.lineTotalCents === null && amount >= 0) current.lineTotalCents = amount;
      else notes.push(`stray amount ${row.amount}`);
      continue;
    }

    if (label) {
      // TOTAL printed with no amount, then never followed by a bare amount row (it landed on a
      // labelled row instead, which we don't recognise as the total). Disarm here rather than
      // let some unrelated bare amount further down silently become the total.
      awaitingTotal = false; awaitingSubtotal = false; awaitingDescuentos = false;
      candidate = row;
    }
  }

  reconcileArithmetic(items, garbledQty, notes);
  for (const it of items) {
    if (it.lineTotalCents === null) notes.push(`item ${it.position} (${it.descPrinted}) has no line total`);
  }
  const offerScan = pairOffers(rows);
  footer.offers = offerScan.pairs;
  if (offerScan.labels.length !== offerScan.amounts.length)
    notes.push(`offers: ${offerScan.labels.length} labels but ${offerScan.amounts.length} amounts`);
  return { header, items, footer, notes };
}
