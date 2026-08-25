import type { SpendMode, ValueMode } from "@/lib/queries";

type SP = { [k: string]: string | string[] | undefined };

export function parseModes(sp: SP): { spend: SpendMode; value: ValueMode } {
  const spend = sp.spend === "cash" ? "cash" : "accrual";
  const value = sp.value === "nominal" ? "nominal" : "real";
  return { spend, value };
}

export function withModes(
  path: string,
  modes: { spend: string; value: string },
  extra: Record<string, string> = {}
): string {
  const q = new URLSearchParams({ spend: modes.spend, value: modes.value, ...extra });
  return `${path}?${q.toString()}`;
}
