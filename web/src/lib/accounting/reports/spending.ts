import { latestMonth, toReal, type CpiTable } from "../../cpi";
import { mepFor, type MepTable } from "../../mep";
import { periodOf } from "../../months";
import { AccountingError } from "../model";
import { validDate } from "../journal";
import { validateReportFacts, type ReportFact, type ReportScope, type SpendRow } from "../read-model";
export type ReportRates = { cpi: CpiTable; mep: MepTable };
export type ValuedFact = { fact: ReportFact; amount: number; month: string; period: string };
export function signedSum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new AccountingError("invalid_minor_units");
  return result;
}
function rate(month: string, rates: ReportRates): number {
  const value = mepFor(month, rates.mep);
  if (!Number.isFinite(value) || value <= 0) throw new AccountingError("invalid_report_rate");
  return value;
}
/** An unlinked issuer payment credit is evidence for money-back/review, not purchase expense. */
export function expenseObservation(fact: ReportFact): boolean {
  return !(fact.kind === "credit" && fact.sourceSection === "payments" && fact.purchaseId === null);
}
/** Ordinary peso lens deliberately excludes native USD; currency lens is separate. */
export function valuedFacts(facts: ReportFact[], scope: ReportScope, rates: ReportRates, filterPeriod = true): ValuedFact[] {
  validateReportFacts(facts);
  const selected = facts.filter(f => expenseObservation(f) && !(scope.basis === "purchase" && f.origin === "issuer_observation") && (f.kind === "credit" || f.kind === (scope.basis === "purchase" ? "purchase" : "billing")));
  const tax = new Map<string, number>(), bases = new Map<string, number>();
  if (scope.tax === "incl") {
    for (const f of facts) {
      if (!f.statementId) continue;
      if (f.kind === "cost" && f.currency === "ARS" && !f.description?.toUpperCase().startsWith("DEVOLUCION")) tax.set(f.statementId, signedSum(tax.get(f.statementId) ?? 0, f.minor));
      if (!expenseObservation(f) || f.kind !== "billing" && f.kind !== "credit") continue;
      const month = f.cycleMonth ?? f.effectiveDate.slice(0, 7);
      const amount = f.currency === "ARS" ? f.minor : f.minor * rate(month, rates);
      bases.set(f.statementId, (bases.get(f.statementId) ?? 0) + amount);
    }
    // Receipt-first purchases can have no billed rows yet. Do not invent allocated issuer tax.
  }
  if (scope.value === "real" && Object.values(rates.cpi).some(value=>!Number.isFinite(value)||value<=0)) throw new AccountingError("invalid_report_rate");
  const baseMonth = scope.value === "real" ? latestMonth(rates.cpi) : "";
  return selected.flatMap(fact => {
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0, 7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0,7) : null);
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
    if (scope.tax === "incl" && base > 0) amount *= 1 + (tax.get(fact.statementId!) ?? 0) / base;
    if (!Number.isFinite(amount)) throw new AccountingError("invalid_report_amount");
    return [{ fact, amount, month, period }];
  });
}
export function spendRows(facts: ReportFact[], scope: ReportScope, rates: ReportRates): SpendRow[] {
  const groups = new Map<string, SpendRow>();
  for (const row of valuedFacts(facts, scope, rates)) {
    const accountId = row.fact.accountId ?? "expense:unallocated", purposeId = row.fact.purposeId;
    const key = JSON.stringify([row.period, accountId, purposeId]);
    const target = groups.get(key) ?? { period: row.period, accountId, purposeId, amount: 0 };
    target.amount += row.amount; groups.set(key, target);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period) || a.accountId.localeCompare(b.accountId) || (a.purposeId ?? "").localeCompare(b.purposeId ?? ""));
}
export function spendingModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates) {
  const rows = spendRows(facts, scope, rates), valued = valuedFacts(facts, scope, rates);
  const purchases = new Set<string>(), merchants = new Map<string, number>();
  for (const { fact, amount } of valued) {
    if ((fact.kind === "purchase" || fact.kind === "billing") && fact.minor > 0) purchases.add(fact.purchaseId ?? fact.id);
    const name = fact.merchant ?? ""; merchants.set(name, (merchants.get(name) ?? 0) + amount);
  }
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0), purchaseCount: purchases.size, merchantTotals: [...merchants].map(([merchant, amount]) => ({ merchant, amount })).sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant)) };
}
export function drillModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates, path: { accountId: string | null; merchant: string | null }) {
  validateReportFacts(facts);
  const matches = (fact: ReportFact) => (path.accountId === null || fact.accountId === path.accountId) && (path.merchant === null || fact.merchant === path.merchant);
  const rows = facts.filter(fact => {
    if (!expenseObservation(fact) || scope.basis === "purchase" && fact.origin === "issuer_observation") return false;
    if (!expenseObservation(fact) || fact.kind !== "credit" && fact.kind !== (scope.basis === "purchase" ? "purchase" : "billing")) return false;
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0,7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0,7) : null);
    if (!month) throw new AccountingError("billing_cycle_missing",{id:fact.id});
    return matches(fact) && (!scope.period || scope.period === "all" || periodOf(month,scope.granularity) === scope.period);
  });
  // Native USD source evidence remains inspectable even when ordinary peso totals omit it.
  return { rows, total: valuedFacts(facts, scope, rates).filter(r=>matches(r.fact)).reduce((sum,r)=>sum+r.amount,0) };
}
export function merchantModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates) {
  const totals = spendingModel(facts, scope, rates).merchantTotals.filter(r => r.amount > 0);
  const total = totals.reduce((sum, r) => sum + r.amount, 0); let cumulativeShare = 0;
  const first = new Map<string, string>(), novelty = new Map<string, { period: string; newAmount: number; returningAmount: number }>();
  // First appearance is monthly, independently of period filtering or later regrouping.
  const all = valuedFacts(facts, scope, rates, false);
  for (const fact of facts) {
    if (!expenseObservation(fact) || fact.kind !== "credit" && fact.kind !== (scope.basis === "purchase" ? "purchase" : "billing")) continue;
    const month = scope.basis === "purchase" ? fact.effectiveDate.slice(0,7) : fact.cycleMonth ?? (fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null ? fact.effectiveDate.slice(0,7) : null);
    if (month && fact.merchant && (!first.has(fact.merchant) || first.get(fact.merchant)! > month)) first.set(fact.merchant,month);
  }
  for (const r of all) {
    const bucket = novelty.get(r.period) ?? { period: r.period, newAmount: 0, returningAmount: 0 };
    if (first.get(r.fact.merchant ?? "") === r.month) bucket.newAmount += r.amount; else bucket.returningAmount += r.amount;
    novelty.set(r.period, bucket);
  }
  return { totals: totals.map(r => { const share = total > 0 ? r.amount / total * 100 : 0; cumulativeShare += share; return { ...r, share, cumulativeShare }; }), novelty: [...novelty.values()].sort((a, b) => a.period.localeCompare(b.period)) };
}
export function moverModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates) {
  const rows = spendRows(facts, { ...scope, period: null }, rates), periods = [...new Set(rows.map(r => r.period))].sort();
  if (periods.length < 2) return [];
  const [beforePeriod, afterPeriod] = periods.slice(-2);
  return [...new Set(rows.map(r => r.accountId))].sort().map(accountId => {
    const amount = (period: string) => rows.filter(r => r.accountId === accountId && r.period === period).reduce((sum, r) => sum + r.amount, 0);
    const before = amount(beforePeriod), after = amount(afterPeriod), delta = after - before;
    return { accountId, before, after, delta, pct: before === 0 ? null : delta / before * 100 };
  }).sort((a,b)=>b.delta-a.delta || a.accountId.localeCompare(b.accountId));
}
export function flowModel(facts: ReportFact[], scope: ReportScope, rates: ReportRates) {
  const leaves = new Map<string, { cardId: string; accountId: string; merchant: string; amount: number }>();
  for (const r of valuedFacts(facts, scope, rates)) {
    const key = JSON.stringify([r.fact.cardId, r.fact.accountId, r.fact.merchant]);
    const row = leaves.get(key) ?? { cardId: r.fact.cardId, accountId: r.fact.accountId ?? "expense:unallocated", merchant: r.fact.merchant ?? "", amount: 0 };
    row.amount += r.amount; leaves.set(key, row);
  }
  const nodes = new Map<string, { id: string; labelId: string }>(), links = new Map<string, { sourceId: string; targetId: string; amount: number }>();
  for (const row of leaves.values()) {
    if (row.amount <= 0) continue;
    const card = `card:${JSON.stringify(row.cardId)}`, account = `account:${JSON.stringify(row.accountId)}`, merchant = `merchant:${JSON.stringify([row.accountId, row.merchant])}`;
    for (const [id, labelId] of [[card, row.cardId], [account, row.accountId], [merchant, row.merchant]]) nodes.set(id, { id, labelId });
    for (const [sourceId, targetId] of [[card, account], [account, merchant]]) {
      const key = JSON.stringify([sourceId, targetId]), link = links.get(key) ?? { sourceId, targetId, amount: 0 };
      link.amount += row.amount; links.set(key, link);
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

/** Separate native measures: actual liabilities, expense flow, and active Q31 repayment flow. */
export function purposeMeasuresFromSnapshot(snapshot: import("../read-model").PurposeSnapshot, input: import("../read-model").PurposeMeasureInput): import("../read-model").PurposeMeasure[] {
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to) throw new AccountingError("invalid_report_date");
  const groups = new Map<string | null, import("../read-model").PurposeMeasure>();
  const group = (purposeId: string | null) => {
    let value = groups.get(purposeId);
    if (!value) { value = { purposeId, expenseMinor: 0, debtMinor: 0, repaymentMinor: 0 }; groups.set(purposeId,value); }
    return value;
  };
  const accountTypes = new Map(snapshot.accounts.map(a=>[a.id,a.type]));
  const journals = snapshot.journals.filter(j=>j.cardId===input.cardId && j.currency===input.currency && j.effectiveDate<=input.to);
  const supported = new Set(snapshot.purchases.filter(p=>p.cardId===input.cardId && p.currency===input.currency).map(p=>p.purchaseId));
  let balance=0, repayments=0;
  for (const journal of journals) for (const line of journal.lines) {
    const net=signedSum(line.creditMinor,-line.debitMinor), type=accountTypes.get(line.accountId);
    if (!type) throw new AccountingError("report_account_missing");
    if (type==="expense" && journal.effectiveDate>=input.from) {
      const target=group(line.purposeId);target.expenseMinor=signedSum(target.expenseMinor,-net);
    }
    if((line.purchaseId && supported.has(line.purchaseId) || journal.kind==="cost") && (type==="expense" || type==="asset")) {
      const target=group(line.purposeId);target.debtMinor=signedSum(target.debtMinor,-net);
    }
    if(type!=="liability")continue;
    balance=signedSum(balance,net);
    if(journal.kind==="repayment" && journal.effectiveDate>=input.from)repayments=signedSum(repayments,-net);
  }
  // Acquisition/credit counterpart postings include financed assets as well as expenses;
  // billing moves only liabilities and adds no principal. Correction reversals net exactly.
  const current=new Map<string,number>();
  for(const row of snapshot.state.attributionRevisions)current.set(row.paymentId,Math.max(current.get(row.paymentId)??0,row.revision));
  for(const row of snapshot.state.attributions)current.set(row.paymentId,Math.max(current.get(row.paymentId)??0,row.revision));
  let assignedFlow=0;
  for(const attribution of snapshot.state.attributions) {
    if(attribution.revision!==current.get(attribution.paymentId))continue;
    const payment=snapshot.state.payments.find(p=>p.id===attribution.paymentId && p.cardId===input.cardId && p.currency===input.currency);
    if(!payment || payment.effectiveDate>input.to)continue;
    const target=group(attribution.purposeId);target.debtMinor=signedSum(target.debtMinor,-attribution.minor);
    if(payment.effectiveDate>=input.from) {target.repaymentMinor=signedSum(target.repaymentMinor,attribution.minor);assignedFlow=signedSum(assignedFlow,attribution.minor);}
  }
  const attributedBalance=[...groups.values()].reduce((sum,row)=>signedSum(sum,row.debtMinor),0);
  const residual=signedSum(balance,-attributedBalance), unappliedFlow=signedSum(repayments,-assignedFlow);
  if(residual || unappliedFlow){const target=group(null);target.debtMinor=signedSum(target.debtMinor,residual);target.repaymentMinor=signedSum(target.repaymentMinor,unappliedFlow);}
  return [...groups.values()].sort((a,b)=>(a.purposeId??"").localeCompare(b.purposeId??""));
}
export async function purposeMeasures(reader: import("../read-model").AccountingReader, input: import("../read-model").PurposeMeasureInput) {
  if(!reader.purposeMeasures)throw new AccountingError("accounting_capability_unavailable",{capability:"purpose_measures"});
  return reader.purposeMeasures(input);
}
