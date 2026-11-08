// Backend-owned pure analytical routines ported from the committed reference.
import { addMonth } from "./months";
function project(input) {
  const upcoming = new Map(input.upcoming.map((u) => [u.month, u.amount]));
  const low = input.variableHistory.length ? Math.min(...input.variableHistory) : 0;
  const high = input.variableHistory.length ? Math.max(...input.variableHistory) : 0;
  const out = [];
  for (let k = 0; k < input.horizon; k++) {
    const month = addMonth(input.startMonth, k);
    const p = Math.pow(1 + input.inflation, k + 1);
    const grow = input.mode === "nominal" ? p : 1;
    const shrink = input.mode === "real" ? p : 1;
    out.push({
      month,
      certain: (upcoming.get(month) ?? 0) / shrink,
      expected: input.recurringMonthly * grow,
      estLow: low * grow,
      estHigh: high * grow
    });
  }
  return out;
}
export {
  project
};
