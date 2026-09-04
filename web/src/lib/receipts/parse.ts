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
const QTY_RE = /^(\d+,\d{3})\s*[xX×хХ]\s*(-?\d[\d.]*,\d{2})$/;
// A stray period or comma sometimes lands between the two digit runs (noise bled in from
// nearby amount text).
export const CODE_RE = /^(\d{10})[.,]?\s+(\d{12,14})$/;
// The L/I readings of "[" only count after a space, or FRUTILLA and SANDIA would end in a tag.
export const TAG_RE = /(?:\[|\(|\||\s[LI])\s*([AM])\s*[\])|J]?\s*$/;
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
 * The scans overlap: page k+1 starts with lines already on page k. Code lines are the anchors —
 * every item has exactly one — so the longest run of codes that ends page k and starts page k+1
 * is the duplicated stretch. Page k+1 loses it, except that the last duplicated item keeps
 * whichever copy carries more discount rows: the page break can fall between an item and its
 * discounts, leaving them on one page only.
 */
export function mergePages(rows: Row[]): Row[] {
  const pageNumbers = [...new Set(rows.map(r => r.page))].sort((a, b) => a - b);
  const pages = pageNumbers.map(p => rows.filter(r => r.page === p));
  let merged: Row[] = pages[0] ?? [];
  for (const next of pages.slice(1)) {
    const a = merged.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const b = next.map((r, i) => ({ i, code: codeOf(r) })).filter(x => x.code !== null);
    const same = (p: { sku: string; ean: string }, q: { sku: string; ean: string }) =>
      p.sku === q.sku || p.ean === q.ean;
    let k = 0;
    for (let n = Math.min(a.length, b.length); n >= 1; n--) {
      const tailA = a.slice(-n), headB = b.slice(0, n);
      if (tailA.every((x, j) => same(x.code!, headB[j].code!))) { k = n; break; }
    }
    if (k === 0) { merged = merged.concat(next); continue; }
    // Every duplicated item's own quantity line (two rows up: the description sits in between)
    // is kept from page k too, except when that copy fails to parse as one at all (a stray
    // character breaks it) and page k+1's reads clean.
    for (let j = 0; j < k; j++) {
      const aIdx = a[a.length - k + j].i - 2, bIdx = b[j].i - 2;
      if (aIdx < 0 || bIdx < 0) continue;
      const prevA = merged[aIdx], prevB = next[bIdx];
      if (!QTY_RE.test(norm(prevA.label)) && QTY_RE.test(norm(prevB.label))) merged[aIdx] = prevB;
    }
    const isDiscount = (r: Row) => TAG_RE.test(norm(r.label)) || DISCOUNT_SHAPE_RE.test(norm(r.label));
    const isTrailer = (r: Row) => isDiscount(r) || (r.label.trim() === "" && r.amount !== null);
    // Rows of page k+1 that belong to its k-th duplicated item: its code row and what trails it.
    let end = b[k - 1].i + 1;
    while (end < next.length && isTrailer(next[end])) end++;
    const lastCodeA = a[a.length - 1].i;
    const tailA = merged.slice(lastCodeA + 1);
    const tailB = next.slice(b[k - 1].i + 1, end);
    const discounts = (rs: Row[]) => rs.filter(isDiscount).length;
    const keptTail = discounts(tailB) > discounts(tailA) ? tailB : tailA;
    // The boundary code row itself is kept from page k, except when that copy is the mangled
    // one (extra text glued on breaks the exact code shape) and page k+1's copy reads clean.
    const boundaryRow = !CODE_RE.test(norm(merged[lastCodeA].label)) && CODE_RE.test(norm(next[b[k - 1].i].label))
      ? next[b[k - 1].i] : merged[lastCodeA];
    merged = merged.slice(0, lastCodeA).concat([boundaryRow], keptTail, next.slice(end));
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

/**
 * One pass over the rows. An item is born at its code line, takes the label row just above it
 * as its description and the quantity line above that (if any) as its quantity, and then owns
 * every discount row until the next quantity line, code line or footer marker.
 */
export function parseRows(input: Row[]): ParsedReceipt {
  const rows = ungluePeriodAmounts(mergePages(input));
  const header = emptyHeader();
  const footer: ParsedFooter = { subtotalCents: null, discountsCents: null, totalCents: null, savingsCents: null, offers: [] };
  const items: ParsedItem[] = [];
  const notes: string[] = [];
  let pending: { qtyMilli: number; unitPriceCents: number } | null = null;
  let candidate: Row | null = null;     // the last unclassified label row: the next description
  let current: ParsedItem | null = null; // the item still accepting a line total and discounts
  // A discount label read before the item's own line total: its amount box landed on the line
  // total instead, and the discount's real amount follows as a bare row. Waits for that row.
  let pendingDiscount: { label: string; tag: "M" | "A" } | null = null;
  let awaitingTotal = false; // TOTAL printed with its amount on the next row instead of this one
  let inOffers = false;
  const offerLabels: string[] = [];
  const offerAmounts: number[] = [];

  for (const row of rows) {
    const label = norm(row.label);
    const amount = row.amount === null ? null : parseAmountCents(row.amount);
    if (row.amount !== null && amount === null) notes.push(`unreadable amount "${row.amount}" next to "${label}"`);
    scanHeader(label, header);

    if (/DETALLE DE OFERTAS/i.test(label)) {
      inOffers = true; offerLabels.length = 0; offerAmounts.length = 0; current = null; candidate = null;
      continue;
    }
    if (inOffers) {
      if (/^TOT\.?\s*AHORRO/i.test(label)) { inOffers = false; footer.savingsCents = amount; continue; }
      if (label) offerLabels.push(label);
      if (amount !== null) offerAmounts.push(amount);
      continue;
    }
    if (/^SUBTOT/i.test(label)) { footer.subtotalCents = amount; current = null; candidate = null; pendingDiscount = null; continue; }
    if (/^DESCUENTOS POR PROMOCIONES/i.test(label)) { footer.discountsCents = amount; continue; }
    if (/^TOTAL\.?$/i.test(label)) {
      if (amount !== null) footer.totalCents = amount; else awaitingTotal = true;
      continue;
    }
    const pay = PAYMENT_RE.exec(label);
    if (pay) { header.paymentMethod = pay[1].toUpperCase(); header.paymentRef = pay[2]; header.paymentCents = amount; continue; }

    const qty = QTY_RE.exec(label);
    if (qty) {
      const q = parseQtyMilli(qty[1]);
      const u = parseAmountCents(qty[2]);
      if (q === null || u === null) notes.push(`unreadable quantity line "${label}"`);
      else pending = { qtyMilli: q, unitPriceCents: u };
      current = null; candidate = null; pendingDiscount = null;
      continue;
    }

    const code = CODE_RE.exec(label);
    if (code) {
      if (!candidate) notes.push(`code line ${code[1]} has no description above it`);
      if (pendingDiscount) notes.push(`discount "${pendingDiscount.label}" never got its amount`);
      const desc = candidate ? norm(candidate.label) : "";
      const marker = /^[=\-−]/.test(desc);
      const descPrinted = marker ? "=" + desc.slice(1).trimStart() : desc;
      const fromCandidate = candidate?.amount == null ? null : parseAmountCents(candidate.amount);
      const qtyMilli = pending?.qtyMilli ?? 1000;
      current = {
        position: items.length + 1,
        descPrinted, noPromo: marker, sku: code[1], ean: code[2], qtyMilli,
        unit: qtyMilli % 1000 !== 0 || KG_RE.test(descPrinted) ? "kg" : "un",
        unitPriceCents: pending?.unitPriceCents ?? null,
        lineTotalCents: amount ?? fromCandidate,
        discounts: [],
      };
      items.push(current);
      pending = null; candidate = null; pendingDiscount = null;
      continue;
    }

    const tag = TAG_RE.exec(label);
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
      else if (current && pendingDiscount) {
        current.discounts.push({ ...pendingDiscount, amountCents: amount > 0 ? -amount : amount });
        pendingDiscount = null;
      } else if (current && current.lineTotalCents === null) current.lineTotalCents = amount;
      else notes.push(`stray amount ${row.amount}`);
      continue;
    }

    if (label) candidate = row;
  }

  for (const it of items) {
    if (it.lineTotalCents === null) notes.push(`item ${it.position} (${it.descPrinted}) has no line total`);
  }
  footer.offers = offerLabels.map((l, i) => ({ label: l, amountCents: offerAmounts[i] ?? null }));
  if (offerLabels.length !== offerAmounts.length)
    notes.push(`offers: ${offerLabels.length} labels but ${offerAmounts.length} amounts`);
  return { header, items, footer, notes };
}
