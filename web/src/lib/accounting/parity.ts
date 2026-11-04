export type ReportSnapshot = { values: Record<string, number | null>; coverage: Record<string, string[]> };
/** Each decision is accepted outside this comparison and pins one exact numerical delta and coverage. */
export type AcceptedDifference = { id: string; key: string; coverage: string[] } & (
 { expectedDelta: number; expectedBefore?: never; expectedAfter?: never } |
 { expectedBefore: number | null; expectedAfter: number | null; expectedDelta?: never }
);
export type DifferenceExplanation = { key: string; decision: string; reason: string; expectedDelta?: number; expectedBefore?: number | null; expectedAfter?: number | null };
export type ParityResult = { unexplained: string[]; approved: string[] };
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function compareParity(before: ReportSnapshot, after: ReportSnapshot, explanations: DifferenceExplanation[], accepted: AcceptedDifference[] = []): ParityResult {
  const result: ParityResult = { unexplained: [], approved: [] };
  for (const key of [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])].sort()) {
    const left = before.values[key], right = after.values[key];
    const coverage = before.coverage[key], nextCoverage = after.coverage[key];
    if (!coverage || !nextCoverage || !same(coverage, nextCoverage)) { result.unexplained.push(`${key}:coverage`); continue; }
    if (left === undefined || right === undefined || left !== null && !Number.isSafeInteger(left) || right !== null && !Number.isSafeInteger(right)) { result.unexplained.push(`${key}:invalid_value`); continue; }
    if (left === right) continue;
    const explanation = explanations.find(e => e.key === key && e.reason.trim());
    const delta = left !== null && right !== null ? right - left : null;
    const decision = explanation && accepted.find(d => d.id === explanation.decision && d.key === key && same(d.coverage, coverage) && (
      "expectedBefore" in d ? d.expectedBefore === left && d.expectedAfter === right && explanation.expectedBefore === left && explanation.expectedAfter === right : d.expectedDelta === delta && explanation.expectedDelta === delta
    ));
    if (decision) result.approved.push(key); else result.unexplained.push(key);
  }
  return result;
}
export type ReleaseGateInput = {
 unexplainedDifferenceCount: number; missingObjectCount: number; unbalancedJournalCount: number;
 preservationScenariosPassed: number; targetScenariosPassed: number; bilingualChecksPassed: boolean;
 hostedOcrPassed: boolean; restorePassed: boolean; cutoverModeSelected: boolean;
 /** A count alone cannot identify the missing scenario or its proof. */
 scenarios?: { id: string; passed: boolean; artifact: string }[];
 artifacts?: { parity: string; objects: string; journals: string; bilingual: string; ocr: string; restore: string; cutover: string };
};
export function releaseGate(input: ReleaseGateInput): { ready: boolean; failures: string[] } {
 const failures: string[] = [];
 for (const [key, code] of [["unexplainedDifferenceCount","unexplained_differences"],["missingObjectCount","missing_objects"],["unbalancedJournalCount","unbalanced_journals"]] as const) if (input[key] !== 0) failures.push(code);
 for (const [key, code] of [["bilingualChecksPassed","bilingual_not_proven"],["hostedOcrPassed","hosted_ocr_not_proven"],["restorePassed","restore_not_proven"],["cutoverModeSelected","cutover_mode_unselected"]] as const) if (input[key] !== true) failures.push(code);
 const scenarios = input.scenarios ?? [];
 for (const [prefix, count, claimed] of [["P",27,input.preservationScenariosPassed],["T",19,input.targetScenariosPassed]] as const) {
  if (claimed !== count) failures.push(`${prefix}:incomplete`);
  for (let i=1;i<=count;i++) {const id=`${prefix}${String(i).padStart(2,"0")}`; const checks=scenarios.filter(s=>s.id===id); if (checks.length!==1 || checks[0].passed!==true || !checks[0].artifact?.trim()) failures.push(id);}
 }
 for (const key of ["parity","objects","journals","bilingual","ocr","restore","cutover"] as const) if (!input.artifacts?.[key]?.trim()) failures.push(`artifact:${key}`);
 return {ready:failures.length===0,failures};
}
