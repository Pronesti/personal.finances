// Pure valuation input; filesystem and reference loading belong to Laravel.
import { monthValue } from "./cpi";
function mepFor(month, table) {
  return monthValue(month, table, "npm run fetch-mep");
}
export {
  mepFor
};
