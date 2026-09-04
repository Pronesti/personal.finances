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
export const CODE_RE = /^(\d{10})\s+(\d{12,14})$/;
// The L/I readings of "[" only count after a space, or FRUTILLA and SANDIA would end in a tag.
export const TAG_RE = /(?:\[|\(|\||\s[LI])\s*([AM])\s*[\])|]?\s*$/;
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

function codeOf(row: Row): { sku: string; ean: string } | null {
  const m = CODE_RE.exec(norm(row.label));
  return m ? { sku: m[1], ean: m[2] } : null;
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
    const isTrailer = (r: Row) => TAG_RE.test(norm(r.label)) || (r.label.trim() === "" && r.amount !== null);
    // Rows of page k+1 that belong to its k-th duplicated item: its code row and what trails it.
    let end = b[k - 1].i + 1;
    while (end < next.length && isTrailer(next[end])) end++;
    const lastCodeA = a[a.length - 1].i;
    const tailA = merged.slice(lastCodeA + 1);
    const tailB = next.slice(b[k - 1].i + 1, end);
    const discounts = (rs: Row[]) => rs.filter(r => TAG_RE.test(norm(r.label))).length;
    const keptTail = discounts(tailB) > discounts(tailA) ? tailB : tailA;
    merged = merged.slice(0, lastCodeA + 1).concat(keptTail, next.slice(end));
  }
  return merged;
}

/**
 * One pass over the rows. An item is born at its code line, takes the label row just above it
 * as its description and the quantity line above that (if any) as its quantity, and then owns
 * every discount row until the next quantity line, code line or footer marker.
 */
export function parseRows(input: Row[]): ParsedReceipt {
  const rows = mergePages(input);
  const header = emptyHeader();
  const footer: ParsedFooter = { subtotalCents: null, discountsCents: null, totalCents: null, savingsCents: null, offers: [] };
  const items: ParsedItem[] = [];
  const notes: string[] = [];
  let pending: { qtyMilli: number; unitPriceCents: number } | null = null;
  let candidate: Row | null = null;     // the last unclassified label row: the next description
  let current: ParsedItem | null = null; // the item still accepting a line total and discounts
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
    if (/^SUBTOT/i.test(label)) { footer.subtotalCents = amount; current = null; candidate = null; continue; }
    if (/^DESCUENTOS POR PROMOCIONES/i.test(label)) { footer.discountsCents = amount; continue; }
    if (/^TOTAL\.?$/i.test(label)) { footer.totalCents = amount; continue; }
    const pay = PAYMENT_RE.exec(label);
    if (pay) { header.paymentMethod = pay[1].toUpperCase(); header.paymentRef = pay[2]; header.paymentCents = amount; continue; }

    const qty = QTY_RE.exec(label);
    if (qty) {
      const q = parseQtyMilli(qty[1]);
      const u = parseAmountCents(qty[2]);
      if (q === null || u === null) notes.push(`unreadable quantity line "${label}"`);
      else pending = { qtyMilli: q, unitPriceCents: u };
      current = null; candidate = null;
      continue;
    }

    const code = CODE_RE.exec(label);
    if (code) {
      if (!candidate) notes.push(`code line ${code[1]} has no description above it`);
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
      pending = null; candidate = null;
      continue;
    }

    const tag = TAG_RE.exec(label);
    if (tag) {
      if (amount === null) { notes.push(`discount "${label}" has no amount`); continue; }
      const discount: DiscountLine = {
        label: norm(label.slice(0, tag.index)), tag: tag[1] as "M" | "A",
        amountCents: amount > 0 ? -amount : amount,
      };
      if (current) current.discounts.push(discount);
      else notes.push(`discount "${label}" has no item to attach to`);
      continue;
    }

    if (!label && amount !== null) {
      if (current && current.lineTotalCents === null) current.lineTotalCents = amount;
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
