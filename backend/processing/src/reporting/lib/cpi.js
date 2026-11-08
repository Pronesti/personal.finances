// Pure valuation input; filesystem and reference loading belong to Laravel.
import { monthsBetween } from "./months";
const CPI_REMEDY = "npm run fetch-ipc";
function monthValue(month, table, remedy) {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error(`table empty \u2014 run ${remedy}`);
  if (table[month] !== void 0) return table[month];
  const earlier = months.filter((m) => m < month);
  if (earlier.length === 0) throw new Error(`No data at or before ${month} \u2014 run ${remedy}`);
  return table[earlier[earlier.length - 1]];
}
function toReal(amountArs, fromMonth, toMonth, table) {
  return amountArs * (monthValue(toMonth, table, CPI_REMEDY) / monthValue(fromMonth, table, CPI_REMEDY));
}
function latestMonth(table) {
  const months = Object.keys(table).sort();
  if (months.length === 0) throw new Error("CPI table empty \u2014 run npm run fetch-ipc");
  return months[months.length - 1];
}
function trailingMonthlyInflation(table, n = 6) {
  const months = Object.keys(table).sort();
  if (months.length < 2) throw new Error(`CPI table too short \u2014 run ${CPI_REMEDY}`);
  const last = months[months.length - 1];
  const first = months[Math.max(0, months.length - 1 - n)];
  const periods = monthsBetween(first, last) - 1;
  return Math.pow(table[last] / table[first], 1 / periods) - 1;
}
export {
  CPI_REMEDY,
  latestMonth,
  monthValue,
  toReal,
  trailingMonthlyInflation
};
