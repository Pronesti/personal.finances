// Backend-owned pure analytical routines ported from the committed reference.
import { valuedFacts } from "./spending";
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function timingModel(facts, scope, rates) {
  const values = valuedFacts(facts, { ...scope, basis: "purchase" }, rates);
  const days = /* @__PURE__ */ new Map(), tickets = /* @__PURE__ */ new Map();
  for (const { fact, amount } of values) {
    const day = days.get(fact.effectiveDate) ?? { date: fact.effectiveDate, amount: 0, purchases: /* @__PURE__ */ new Set() };
    day.amount += amount;
    if (fact.kind === "purchase" && amount > 0) {
      const id = fact.purchaseId ?? fact.id;
      day.purchases.add(id);
      tickets.set(id, (tickets.get(id) ?? 0) + amount);
    }
    days.set(fact.effectiveDate, day);
  }
  return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({ date: day.date, amount: day.amount, purchaseCount: day.purchases.size })), medianTicket: median([...tickets.values()]) };
}
const epoch = (date) => Date.parse(date + "T00:00:00Z") / 864e5;
function paceModel(facts, statements, scope, rates) {
  const values = valuedFacts(facts, { ...scope, basis: "purchase", period: null }, rates, false);
  const cycles = statements.filter((s) => s.current && s.previousClosingDate !== null).sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.cardId.localeCompare(b.cardId));
  const completed = [];
  return cycles.map((statement) => {
    const length = epoch(statement.closingDate) - epoch(statement.previousClosingDate);
    const daily = /* @__PURE__ */ new Map();
    for (const { fact, amount } of values) {
      if (fact.cardId !== statement.cardId || fact.effectiveDate <= statement.previousClosingDate || fact.effectiveDate > statement.closingDate) continue;
      const day = epoch(fact.effectiveDate) - epoch(statement.previousClosingDate);
      daily.set(day, (daily.get(day) ?? 0) + amount);
    }
    let cumulative = 0;
    const points = Array.from({ length: Math.max(0, length) }, (_, i) => {
      const day = i + 1;
      cumulative += daily.get(day) ?? 0;
      return { day, cumulative };
    });
    const prior = completed.filter((c) => c.cardId === statement.cardId);
    const priorMedian = prior.length ? points.map((point) => ({ day: point.day, cumulative: median(prior.map((c) => c.points[Math.min(point.day, c.points.length) - 1]?.cumulative ?? 0)) })) : [];
    completed.push({ cardId: statement.cardId, points });
    return { cardId: statement.cardId, cycleMonth: statement.cycleMonth, points, priorMedian };
  });
}
export {
  median,
  paceModel,
  timingModel
};
