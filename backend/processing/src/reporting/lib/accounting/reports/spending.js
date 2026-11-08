// Backend-owned pure analytical routines ported from the committed reference.
import { latestMonth, toReal } from "../../cpi";
import { mepFor } from "../../mep";
import { periodOf } from "../../months";
import { AccountingError } from "../model";
import { validDate } from "../journal";
import { validateReportFacts } from "../read-model";
function signedSum(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new AccountingError("invalid_minor_units");
  return result;
}
function rate(month, rates) {
  const value = mepFor(month, rates.mep);
  if (!Number.isFinite(value) || value <= 0) throw new AccountingError("invalid_report_rate");
  return value;
}
function expenseObservation(fact) {
  return !(fact.kind === "credit" && fact.sourceSection === "payments" && fact.purchaseId === null);
}
function valuedFacts(facts, scope, rates, filterPeriod = true) {
  validateReportFacts(facts);
  const selected = facts.filter((f) => expenseObservation(f) && !(scope.basis === "purchase" && f.origin === "issuer_observation") && (f.kind === "credit" || f.kind === (scope.basis === "purchase" ? "purchase" : "billing")));
  const tax = /* @__PURE__ */ new Map(), bases = /* @__PURE__ */ new Map();
  if (scope.tax === "incl") {
    for (const f of facts) {
      if (!f.statementId) continue;
      if (f.kind === "cost" && f.currency === "ARS" && !f.description?.toUpperCase().startsWith("DEVOLUCION")) tax.set(f.statementId, signedSum(tax.get(f.statementId) ?? 0, f.minor));
      if (!expenseObservation(f) || f.kind !== "billing" && f.kind !== "credit") continue;
      const month = f.cycleMonth ?? f.effectiveDate.slice(0, 7);
      const amount = f.currency === "ARS" ? f.minor : f.minor * rate(month, rates);
      bases.set(f.statementId, (bases.get(f.statementId) ?? 0) + amount);
    }
  }
  if (scope.value === "real" && Object.values(rates.cpi).some((value) => !Number.isFinite(value) || value <= 0)) throw new AccountingError("invalid_report_rate");
  const baseMonth = scope.value === "real" ? latestMonth(rates.cpi) : "";
  return selected.flatMap((fact) => {
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0, 7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0, 7) : null);
    if (!month) throw new AccountingError("billing_cycle_missing", { id: fact.id });
    const period = periodOf(month, scope.granularity);
    if (filterPeriod && scope.period && scope.period !== "all" && period !== scope.period) return [];
    if (fact.currency === "USD" && scope.value !== "usd") return [];
    let amount = fact.minor / 100;
    if (fact.currency === "ARS") {
      if (scope.value === "usd") amount /= rate(month, rates);
      else if (scope.value === "real") {
        amount = toReal(amount, month, baseMonth, rates.cpi);
        if (!Number.isFinite(amount)) throw new AccountingError("invalid_report_rate");
      }
    }
    const base = fact.statementId ? bases.get(fact.statementId) ?? 0 : 0;
    if (scope.tax === "incl" && base > 0) amount *= 1 + (tax.get(fact.statementId) ?? 0) / base;
    if (!Number.isFinite(amount)) throw new AccountingError("invalid_report_amount");
    return [{ fact, amount, month, period }];
  });
}
function spendRows(facts, scope, rates) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of valuedFacts(facts, scope, rates)) {
    const accountId = row.fact.accountId ?? "expense:unallocated", purposeId = row.fact.purposeId;
    const key = JSON.stringify([row.period, accountId, purposeId]);
    const target = groups.get(key) ?? { period: row.period, accountId, purposeId, amount: 0 };
    target.amount += row.amount;
    groups.set(key, target);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period) || a.accountId.localeCompare(b.accountId) || (a.purposeId ?? "").localeCompare(b.purposeId ?? ""));
}
function spendingModel(facts, scope, rates) {
  const rows = spendRows(facts, scope, rates), valued = valuedFacts(facts, scope, rates);
  const purchases = /* @__PURE__ */ new Set(), merchants = /* @__PURE__ */ new Map();
  for (const { fact, amount } of valued) {
    if ((fact.kind === "purchase" || fact.kind === "billing") && fact.minor > 0) purchases.add(fact.purchaseId ?? fact.id);
    const name = fact.merchant ?? "";
    merchants.set(name, (merchants.get(name) ?? 0) + amount);
  }
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0), purchaseCount: purchases.size, merchantTotals: [...merchants].map(([merchant, amount]) => ({ merchant, amount })).sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant)) };
}
function drillModel(facts, scope, rates, path) {
  validateReportFacts(facts);
  const matches = (fact) => (path.accountId === null || fact.accountId === path.accountId) && (path.merchant === null || fact.merchant === path.merchant);
  const rows = facts.filter((fact) => {
    if (!expenseObservation(fact) || scope.basis === "purchase" && fact.origin === "issuer_observation") return false;
    if (!expenseObservation(fact) || fact.kind !== "credit" && fact.kind !== (scope.basis === "purchase" ? "purchase" : "billing")) return false;
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0, 7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0, 7) : null);
    if (!month) throw new AccountingError("billing_cycle_missing", { id: fact.id });
    return matches(fact) && (!scope.period || scope.period === "all" || periodOf(month, scope.granularity) === scope.period);
  });
  return { rows, total: valuedFacts(facts, scope, rates).filter((r) => matches(r.fact)).reduce((sum, r) => sum + r.amount, 0) };
}
function merchantModel(facts, scope, rates) {
  const totals = spendingModel(facts, scope, rates).merchantTotals.filter((r) => r.amount > 0);
  const total = totals.reduce((sum, r) => sum + r.amount, 0);
  let cumulativeShare = 0;
  const first = /* @__PURE__ */ new Map(), novelty = /* @__PURE__ */ new Map();
  const all = valuedFacts(facts, scope, rates, false);
  for (const fact of facts) {
    if (!expenseObservation(fact) || fact.kind !== "credit" && fact.kind !== (scope.basis === "purchase" ? "purchase" : "billing")) continue;
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0, 7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0, 7) : null);
    if (month && fact.merchant && (!first.has(fact.merchant) || first.get(fact.merchant) > month)) first.set(fact.merchant, month);
  }
  for (const r of all) {
    const bucket = novelty.get(r.period) ?? { period: r.period, newAmount: 0, returningAmount: 0 };
    if (first.get(r.fact.merchant ?? "") === r.month) bucket.newAmount += r.amount;
    else bucket.returningAmount += r.amount;
    novelty.set(r.period, bucket);
  }
  return { totals: totals.map((r) => {
    const share = total > 0 ? r.amount / total * 100 : 0;
    cumulativeShare += share;
    return { ...r, share, cumulativeShare };
  }), novelty: [...novelty.values()].sort((a, b) => a.period.localeCompare(b.period)) };
}
function moverModel(facts, scope, rates) {
  const rows = spendRows(facts, { ...scope, period: null }, rates), periods = [...new Set(rows.map((r) => r.period))].sort();
  if (periods.length < 2) return [];
  const [beforePeriod, afterPeriod] = periods.slice(-2);
  return [...new Set(rows.map((r) => r.accountId))].sort().map((accountId) => {
    const amount = (period) => rows.filter((r) => r.accountId === accountId && r.period === period).reduce((sum, r) => sum + r.amount, 0);
    const before = amount(beforePeriod), after = amount(afterPeriod), delta = after - before;
    return { accountId, before, after, delta, pct: before === 0 ? null : delta / before * 100 };
  }).sort((a, b) => b.delta - a.delta || a.accountId.localeCompare(b.accountId));
}
function flowModel(facts, scope, rates) {
  const leaves = /* @__PURE__ */ new Map();
  for (const r of valuedFacts(facts, scope, rates)) {
    const key = JSON.stringify([r.fact.cardId, r.fact.accountId, r.fact.merchant]);
    const row = leaves.get(key) ?? { cardId: r.fact.cardId, accountId: r.fact.accountId ?? "expense:unallocated", merchant: r.fact.merchant ?? "", amount: 0 };
    row.amount += r.amount;
    leaves.set(key, row);
  }
  const nodes = /* @__PURE__ */ new Map(), links = /* @__PURE__ */ new Map();
  for (const row of leaves.values()) {
    if (row.amount <= 0) continue;
    const card = `card:${JSON.stringify(row.cardId)}`, account = `account:${JSON.stringify(row.accountId)}`, merchant = `merchant:${JSON.stringify([row.accountId, row.merchant])}`;
    for (const [id, labelId] of [[card, row.cardId], [account, row.accountId], [merchant, row.merchant]]) nodes.set(id, { id, labelId });
    for (const [sourceId, targetId] of [[card, account], [account, merchant]]) {
      const key = JSON.stringify([sourceId, targetId]), link = links.get(key) ?? { sourceId, targetId, amount: 0 };
      link.amount += row.amount;
      links.set(key, link);
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}
function purposeMeasuresFromSnapshot(snapshot, input) {
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to) throw new AccountingError("invalid_report_date");
  const groups = /* @__PURE__ */ new Map();
  const group = (purposeId) => {
    let value = groups.get(purposeId);
    if (!value) {
      value = { purposeId, expenseMinor: 0, debtMinor: 0, repaymentMinor: 0 };
      groups.set(purposeId, value);
    }
    return value;
  };
  const accountTypes = new Map(snapshot.accounts.map((a) => [a.id, a.type]));
  const journals = snapshot.journals.filter((j) => j.cardId === input.cardId && j.currency === input.currency && j.effectiveDate <= input.to);
  const supported = new Set(snapshot.purchases.filter((p) => p.cardId === input.cardId && p.currency === input.currency).map((p) => p.purchaseId));
  let balance = 0, repayments = 0;
  for (const journal of journals) for (const line of journal.lines) {
    const net = signedSum(line.creditMinor, -line.debitMinor), type = accountTypes.get(line.accountId);
    if (!type) throw new AccountingError("report_account_missing");
    if (type === "expense" && journal.effectiveDate >= input.from) {
      const target = group(line.purposeId);
      target.expenseMinor = signedSum(target.expenseMinor, -net);
    }
    if ((line.purchaseId && supported.has(line.purchaseId) || journal.kind === "cost") && (type === "expense" || type === "asset")) {
      const target = group(line.purposeId);
      target.debtMinor = signedSum(target.debtMinor, -net);
    }
    if (type !== "liability") continue;
    balance = signedSum(balance, net);
    if (journal.kind === "repayment" && journal.effectiveDate >= input.from) repayments = signedSum(repayments, -net);
  }
  const current = /* @__PURE__ */ new Map();
  for (const row of snapshot.state.attributionRevisions) current.set(row.paymentId, Math.max(current.get(row.paymentId) ?? 0, row.revision));
  for (const row of snapshot.state.attributions) current.set(row.paymentId, Math.max(current.get(row.paymentId) ?? 0, row.revision));
  let assignedFlow = 0;
  for (const attribution of snapshot.state.attributions) {
    if (attribution.revision !== current.get(attribution.paymentId)) continue;
    const payment = snapshot.state.payments.find((p) => p.id === attribution.paymentId && p.cardId === input.cardId && p.currency === input.currency);
    if (!payment || payment.effectiveDate > input.to) continue;
    const target = group(attribution.purposeId);
    target.debtMinor = signedSum(target.debtMinor, -attribution.minor);
    if (payment.effectiveDate >= input.from) {
      target.repaymentMinor = signedSum(target.repaymentMinor, attribution.minor);
      assignedFlow = signedSum(assignedFlow, attribution.minor);
    }
  }
  const attributedBalance = [...groups.values()].reduce((sum, row) => signedSum(sum, row.debtMinor), 0);
  const residual = signedSum(balance, -attributedBalance), unappliedFlow = signedSum(repayments, -assignedFlow);
  if (residual || unappliedFlow) {
    const target = group(null);
    target.debtMinor = signedSum(target.debtMinor, residual);
    target.repaymentMinor = signedSum(target.repaymentMinor, unappliedFlow);
  }
  return [...groups.values()].sort((a, b) => (a.purposeId ?? "").localeCompare(b.purposeId ?? ""));
}
async function purposeMeasures(reader, input) {
  if (!reader.purposeMeasures) throw new AccountingError("accounting_capability_unavailable", { capability: "purpose_measures" });
  return reader.purposeMeasures(input);
}
export {
  drillModel,
  expenseObservation,
  flowModel,
  merchantModel,
  moverModel,
  purposeMeasures,
  purposeMeasuresFromSnapshot,
  signedSum,
  spendRows,
  spendingModel,
  valuedFacts
};
