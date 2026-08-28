import { addMonth } from "@/lib/months";
import type { ValueMode } from "@/lib/queries";

export type ProjectionMonth = {
  month: string;
  certain: number;   // contractual installments from the newest statement per brand
  expected: number;  // detected recurring charges carried forward
  estLow: number;    // variable spend band, low edge
  estHigh: number;   // variable spend band, high edge
};

export function project(input: {
  startMonth: string;
  horizon: number;
  upcoming: { month: string; amount: number }[];
  recurringMonthly: number;
  variableHistory: number[];
  inflation: number;
  mode: ValueMode;
}): ProjectionMonth[] {
  const upcoming = new Map(input.upcoming.map(u => [u.month, u.amount]));
  const low = input.variableHistory.length ? Math.min(...input.variableHistory) : 0;
  const high = input.variableHistory.length ? Math.max(...input.variableHistory) : 0;
  const out: ProjectionMonth[] = [];
  for (let k = 0; k < input.horizon; k++) {
    const month = addMonth(input.startMonth, k);
    const p = Math.pow(1 + input.inflation, k + 1);
    // Recurring and variable spend are assumed to track inflation. So in nominal terms they
    // grow; in constant pesos they are flat. The contractual installment schedule is the mirror
    // image: fixed in nominal pesos, therefore shrinking in constant ones. USD figures are
    // converted at the latest MEP by the caller; peso drift is not modelled.
    const grow = input.mode === "nominal" ? p : 1;
    const shrink = input.mode === "real" ? p : 1;
    out.push({
      month,
      certain: (upcoming.get(month) ?? 0) / shrink,
      expected: input.recurringMonthly * grow,
      estLow: low * grow,
      estHigh: high * grow,
    });
  }
  return out;
}
