// Backend-owned pure analytical routines ported from the committed reference.
import { AccountingError } from "./model";
import { validDate } from "./journal";
class AccountingCapabilityError extends AccountingError {
  constructor(capability) {
    super("accounting_capability_unavailable", { capability });
  }
}
function validateReportFacts(facts) {
  const ids = /* @__PURE__ */ new Set(), sums = /* @__PURE__ */ new Map();
  for (const fact of facts) {
    if (!fact.id || ids.has(fact.id)) throw new AccountingError("invalid_report_identity");
    ids.add(fact.id);
    if (!Number.isSafeInteger(fact.minor)) throw new AccountingError("invalid_minor_units");
    const key = `${fact.kind}:${fact.currency}`, total = (sums.get(key) ?? 0) + fact.minor;
    if (!Number.isSafeInteger(total)) throw new AccountingError("invalid_minor_units");
    sums.set(key, total);
    if (!validDate(fact.effectiveDate) || fact.cycleMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fact.cycleMonth)) throw new AccountingError("invalid_report_date");
    if (!["ARS", "USD"].includes(fact.currency)) throw new AccountingError("invalid_currency");
  }
  return facts;
}
async function loadReportFacts(reader) {
  return validateReportFacts(await reader.facts());
}
export {
  AccountingCapabilityError,
  loadReportFacts,
  validateReportFacts
};
