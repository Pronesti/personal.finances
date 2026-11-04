import type {ReportFact, StatementFact} from "./read-model";
/** Shared navigation coverage: issuer cycles plus independently supported acquisition months.
 * Billing and payment effective dates describe ledger movements, not new report periods.
 */
export function reportMonths(facts: ReportFact[], statements: StatementFact[]): string[] {
  return [...new Set([
    ...statements.filter(statement=>statement.current).map(statement=>statement.cycleMonth),
    ...facts.filter(fact=>fact.kind==="purchase"&&fact.origin!=="issuer_observation"||fact.kind==="credit"&&fact.origin==="ledger"&&fact.purchaseId!==null).map(fact=>fact.effectiveDate.slice(0,7)),
  ])].sort();
}
