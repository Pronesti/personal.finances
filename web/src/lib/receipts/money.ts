// Coto prints amounts with a decimal comma and no thousands separator ("146931,91"). Everything
// here is integer cents or integer thousandths: the verification gate compares integers, and a
// float that lands 0.004 off would fail a receipt that reconciles on paper.

const AMOUNT_RE = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/;
const QTY_RE = /^(\d+),(\d{3})$/;

function clean(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/^\$/, "");
}

/** "4454,63" → 445463; "-1336,39" → -133639; anything else → null. */
export function parseAmountCents(raw: string): number | null {
  const m = AMOUNT_RE.exec(clean(raw));
  if (!m) return null;
  const cents = Number(m[2].replace(/\./g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}

export function isAmount(raw: string): boolean {
  return parseAmountCents(raw) !== null;
}

/** "0,172" → 172 (kg in grams); "4,000" → 4000 (units in thousandths). Three decimals always. */
export function parseQtyMilli(raw: string): number | null {
  const m = QTY_RE.exec(clean(raw));
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}

const plain = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ars = new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function fmtCents(cents: number): string {
  return plain.format(cents / 100);
}

/** Receipts are the one place the app shows cents: a gate that reconciles to the cent must show them. */
export function fmtArsCents(cents: number): string {
  return ars.format(cents / 100);
}
