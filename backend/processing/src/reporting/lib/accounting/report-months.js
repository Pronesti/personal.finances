// Backend-owned pure analytical routines ported from the committed reference.
function reportMonths(facts, statements) {
  return [.../* @__PURE__ */ new Set([
    ...statements.filter((statement) => statement.current).map((statement) => statement.cycleMonth),
    ...facts.filter((fact) => fact.kind === "purchase" && fact.origin !== "issuer_observation" || fact.kind === "credit" && fact.origin === "ledger" && fact.purchaseId !== null).map((fact) => fact.effectiveDate.slice(0, 7))
  ])].sort();
}
export {
  reportMonths
};
