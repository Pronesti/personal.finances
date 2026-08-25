import type { ValueMode } from "@/lib/queries";

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function fmtArs(n: number): string {
  return ars.format(n);
}

// Every chart and tile that can render a USD-mode figure must go through this, not fmtArs.
export function fmtMoney(n: number, value: ValueMode): string {
  return value === "usd" ? `US$ ${n.toFixed(2)}` : fmtArs(n);
}

export function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(1).replace(".", ",")}%`;
}
