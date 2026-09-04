import { fmtCents } from "./money";
import type { ParsedReceipt } from "./parse";

export type Check = {
  name: "subtotal" | "discounts" | "total";
  computed: number;
  printed: number | null;
  ok: boolean;
};
export type OfferCheck = { label: string; printed: number | null; computed: number | null; ok: boolean };
export type VerificationReport = {
  ok: boolean;
  checks: Check[];
  offers: OfferCheck[];
  warnings: string[];
  errors: string[];
};

function check(name: Check["name"], computed: number, printed: number | null): Check {
  return { name, computed, printed, ok: printed !== null && printed === computed };
}

function offerKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * The gate. Integers only: the sum of the line totals must be the printed subtotal, the sum of
 * every discount line the printed discounts, and their sum the printed total — to the cent. A
 * receipt that fails any of them is not admitted. Everything else here is advice for the
 * reader: a unit price that does not multiply out (analytics derive unit prices from the line
 * total anyway), an offer whose printed total does not match its lines, TOT.AHORRO drifting.
 */
export function verify(p: ParsedReceipt): VerificationReport {
  const errors: string[] = [];
  const warnings: string[] = [...p.notes.filter(n => !n.includes("has no line total"))];

  if (!p.header.date) errors.push("date not read from the header");
  if (!p.header.fiscalNumber) errors.push("ticket number (NRO.T.) not read from the header");
  if (p.items.length === 0) errors.push("no items read");
  for (const it of p.items) {
    if (it.lineTotalCents === null) errors.push(`item ${it.position} (${it.descPrinted}) has no line total`);
  }

  const subtotal = p.items.reduce((s, it) => s + (it.lineTotalCents ?? 0), 0);
  const discounts = p.items.reduce((s, it) => s + it.discounts.reduce((d, x) => d + x.amountCents, 0), 0);
  const total = subtotal + discounts;
  const checks: Check[] = [
    check("subtotal", subtotal, p.footer.subtotalCents),
    check("discounts", discounts, p.footer.discountsCents),
    check("total", total, p.footer.totalCents),
  ];
  for (const c of checks) {
    if (c.printed === null) errors.push(`printed ${c.name} not read`);
  }

  if (p.footer.savingsCents !== null && p.footer.savingsCents !== -discounts)
    warnings.push(`TOT.AHORRO reads ${fmtCents(p.footer.savingsCents)} but the discount lines sum to ${fmtCents(-discounts)}`);

  for (const it of p.items) {
    if (it.unitPriceCents === null || it.lineTotalCents === null) continue;
    const expected = Math.round(it.qtyMilli * it.unitPriceCents / 1000);
    if (Math.abs(expected - it.lineTotalCents) > 1)
      warnings.push(`item ${it.position} (${it.descPrinted}): ${it.qtyMilli / 1000} × ${fmtCents(it.unitPriceCents)} = ${fmtCents(expected)} but the line total is ${fmtCents(it.lineTotalCents)}; the unit price is probably misread`);
  }

  const byLabel = new Map<string, number>();
  for (const it of p.items) {
    for (const d of it.discounts) byLabel.set(offerKey(d.label), (byLabel.get(offerKey(d.label)) ?? 0) + d.amountCents);
  }
  const offers = p.footer.offers.map(o => {
    const computed = byLabel.get(offerKey(o.label)) ?? null;
    const ok = o.amountCents !== null && computed !== null && computed === -o.amountCents;
    if (!ok)
      warnings.push(`offer "${o.label}": printed ${o.amountCents === null ? "nothing" : fmtCents(o.amountCents)}, item lines give ${computed === null ? "no match" : fmtCents(-computed)}`);
    return { label: o.label, printed: o.amountCents, computed, ok };
  });

  return { ok: errors.length === 0 && checks.every(c => c.ok), checks, offers, warnings, errors };
}
