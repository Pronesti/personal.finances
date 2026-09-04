import { isAmount } from "./money";
import type { Box } from "./ocr";

/** One printed line: what is on the left, and the amount on the right if there is one. */
export type Row = { page: number; label: string; amount: string | null };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Vision returns boxes in no order and splits a printed line into two or three of them (label,
 * tag, amount). Boxes whose vertical centres sit within 0.6 median box heights of the row's
 * first box are one row. The amount is the rightmost amount-shaped box in the right half of the
 * page: line totals and discounts are right-aligned, and nothing else there looks like money.
 */
export function boxesToRows(boxes: Box[]): Row[] {
  const rows: Row[] = [];
  const pages = [...new Set(boxes.map(b => b.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const sorted = boxes.filter(b => b.page === page)
      .map(b => ({ ...b, cy: b.y + b.h / 2 }))
      .sort((a, b) => a.cy - b.cy);
    const tolerance = median(sorted.map(b => b.h)) * 0.6;
    let group: typeof sorted = [];
    const flush = () => {
      if (group.length === 0) return;
      const byX = [...group].sort((a, b) => a.x - b.x);
      let amountAt = -1;
      for (let i = byX.length - 1; i >= 0; i--) {
        if (byX[i].x >= 0.5 && isAmount(byX[i].text)) { amountAt = i; break; }
      }
      const label = byX.filter((_, i) => i !== amountAt).map(b => b.text.trim()).join(" ")
        .replace(/\s+/g, " ").trim();
      rows.push({ page, label, amount: amountAt >= 0 ? byX[amountAt].text.replace(/\s+/g, "") : null });
      group = [];
    };
    for (const box of sorted) {
      if (group.length > 0 && box.cy - group[0].cy > tolerance) flush();
      group.push(box);
    }
    flush();
  }
  return rows;
}

export function serializeRows(rows: Row[]): string {
  const out: string[] = [];
  let page = 0;
  for (const r of rows) {
    if (r.page !== page) { page = r.page; out.push(`## page ${page}`); }
    out.push(r.amount === null ? r.label : `${r.label}\t${r.amount}`);
  }
  return out.join("\n") + "\n";
}

const PAGE_LINE = /^## page (\d+)$/;
// A tail that is an amount after two or more spaces: the textarea has no tab key.
const SPACED_AMOUNT = /^(.*?)\s{2,}(-?[\d.]+,\d{2})$/;

export function parseRowsText(text: string): Row[] {
  const rows: Row[] = [];
  let page = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const pm = PAGE_LINE.exec(line.trim());
    if (pm) { page = Number(pm[1]); continue; }
    const tab = line.lastIndexOf("\t");
    if (tab >= 0) {
      const amount = line.slice(tab + 1).trim();
      rows.push({ page, label: line.slice(0, tab).trim(), amount: amount || null });
      continue;
    }
    const sm = SPACED_AMOUNT.exec(line);
    if (sm && isAmount(sm[2])) rows.push({ page, label: sm[1].trim(), amount: sm[2] });
    else rows.push({ page, label: line.trim(), amount: null });
  }
  return rows;
}
