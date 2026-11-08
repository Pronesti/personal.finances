// Backend-owned pure analytical routines ported from the committed reference.
import { commitmentEnglish, commitmentSpanish } from "../commitment-messages";
import { createHash } from "node:crypto";
import { detectRecurring } from "../../recurring";
import { project } from "../../projection";
import { personalInflationIndex } from "../../inflation";
import { detectAnomalies } from "../../anomalies";
import { latestMonth, toReal, trailingMonthlyInflation, monthValue, CPI_REMEDY } from "../../cpi";
import { mepFor } from "../../mep";
import { addMonth, periodOf } from "../../months";
import { spendRows, signedSum, expenseObservation, valuedFacts } from "./spending";
import { AccountingError } from "../model";
function commitmentModel(input) {
  const upcoming = /* @__PURE__ */ new Map();
  for (const s of input.schedules.filter((s2) => s2.current && s2.month >= input.startMonth)) upcoming.set(s.month, (upcoming.get(s.month) ?? 0) + s.amount);
  return { forecast: project({ startMonth: input.startMonth, horizon: 6, upcoming: [...upcoming].map(([month, amount]) => ({ month, amount })), recurringMonthly: input.recurring.filter((r) => r.status === "active" && r.confidence === "high" && r.currency === "ARS").reduce((sum, r) => sum + r.lastAmount, 0), variableHistory: input.variableHistory.filter((v) => v > 0), inflation: input.inflation, mode: input.value }), remainingPrincipal: [...upcoming.values()].reduce((sum, n) => sum + n, 0) };
}
function valueArs(amount, month, scope, rates) {
  if (scope.value === "nominal") return amount;
  if (scope.value === "usd") return amount / mepFor(month, rates.mep);
  return toReal(amount, month, latestMonth(rates.cpi), rates.cpi);
}
function billedObservations(facts) {
  const groups = /* @__PURE__ */ new Map(), financed = new Set(facts.filter((f) => f.financed).map((f) => f.purchaseId));
  for (const f of facts.filter((f2) => expenseObservation(f2) && (f2.kind === "billing" || f2.kind === "credit"))) {
    if (!f.cycleMonth) continue;
    const key = f.journalId ?? f.id;
    const row = groups.get(key) ?? { id: key, purchaseId: f.purchaseId, cardId: f.cardId, statementId: f.statementId, merchant: f.merchant ?? "", month: f.cycleMonth, date: f.purchaseDate ?? f.effectiveDate, description: f.description ?? f.merchant ?? "", ars: f.currency === "ARS" ? 0 : null, usd: f.currency === "USD" ? 0 : null, minor: 0, currency: f.currency, financed: f.financed ?? financed.has(f.purchaseId), installmentCount: f.installmentCount ?? null, installmentNumber: f.installmentNumber ?? null };
    row.minor = signedSum(row.minor, f.minor);
    if (f.currency === "ARS") row.ars = row.minor / 100;
    else row.usd = row.minor / 100;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
}
function recurringModel(facts, rates) {
  const rows = billedObservations(facts).filter((r) => !r.financed);
  return detectRecurring(rows.map((r) => ({ ...r, installment_count: r.installmentCount })), { cpi: rates.cpi, latestMonth: rows.at(-1)?.month });
}
function inflationModel(facts, rates) {
  const rows = billedObservations(facts).filter((r) => !r.financed), names = new Set(recurringModel(facts, rates).filter((r) => r.currencies.includes("ARS")).map((r) => r.merchant));
  const counts = /* @__PURE__ */ new Map();
  for (const row of rows) if (row.ars !== null) counts.set(JSON.stringify([row.merchant, row.month]), (counts.get(JSON.stringify([row.merchant, row.month])) ?? 0) + 1);
  const basket = rows.filter((r) => names.has(r.merchant) && r.ars !== null && r.ars > 0 && counts.get(JSON.stringify([r.merchant, r.month])) === 1).map((r) => ({ merchant: r.merchant, month: r.month, ars: r.ars }));
  return { points: personalInflationIndex(basket, rates.cpi), basket: [...new Set(basket.map((r) => r.merchant))].sort() };
}
function taxKind(description, accountId) {
  const text = description.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.startsWith("DEVOLUCION")) return null;
  if (text.includes("RG 5617")) return "rg5617";
  if (text.includes("IVA")) return "iva";
  if (text.includes("IIBB")) return "iibb";
  if (text.includes("SELLOS") || accountId?.endsWith(":stamp")) return "stampDuty";
  if (text.includes("INTERES") || accountId?.endsWith(":interest")) return "interest";
  return "other";
}
function taxesModel(facts, scope, rates) {
  const buckets = /* @__PURE__ */ new Map();
  const get = (month) => {
    const period = periodOf(month, scope.granularity);
    let row = buckets.get(period);
    if (!row) {
      row = { period, rg5617: 0, iva: 0, iibb: 0, stampDuty: 0, interest: 0, other: 0, total: 0, ratePct: null, nativeTax: 0, nativeBase: 0 };
      buckets.set(period, row);
    }
    return row;
  };
  for (const f of facts.filter((f2) => f2.kind === "cost" && f2.currency === "ARS")) {
    const kind = taxKind(f.description ?? "", f.accountId);
    if (!kind) continue;
    const month = f.cycleMonth ?? f.effectiveDate.slice(0, 7), row = get(month), native = f.minor / 100, amount = valueArs(native, month, scope, rates);
    row[kind] += amount;
    row.total += amount;
    row.nativeTax += native;
  }
  for (const f of facts.filter((f2) => expenseObservation(f2) && (f2.kind === "billing" || f2.kind === "credit"))) {
    const month = f.cycleMonth ?? f.effectiveDate.slice(0, 7), period = periodOf(month, scope.granularity), row = buckets.get(period);
    if (row) row.nativeBase += f.minor / 100 * (f.currency === "USD" ? mepFor(month, rates.mep) : 1);
  }
  return [...buckets.values()].map(({ nativeTax, nativeBase, ...row }) => ({ ...row, ratePct: nativeBase > 0 ? nativeTax / nativeBase * 100 : null })).sort((a, b) => a.period.localeCompare(b.period));
}
function creditsModel(facts, scope, rates) {
  const buckets = /* @__PURE__ */ new Map(), items = [];
  for (const f of facts.filter((f2) => f2.kind === "credit" && f2.currency === "ARS" && f2.minor < 0)) {
    const month = f.cycleMonth ?? f.effectiveDate.slice(0, 7), period = periodOf(month, scope.granularity), text = (f.description ?? "").toUpperCase(), kind = text.includes("RG 5617") ? "taxback" : /BONIF|OFF/.test(text) ? "promo" : "refund", native = -f.minor / 100, amount = valueArs(native, month, scope, rates);
    const row = buckets.get(period) ?? { period, promo: 0, refund: 0, taxback: 0, total: 0, pctOfSpend: null, native: 0, base: 0 };
    row[kind] += amount;
    row.total += amount;
    row.native += native;
    buckets.set(period, row);
    items.push({ month, date: f.effectiveDate, merchant: f.merchant ?? "", description: f.description ?? "", kind, amount });
  }
  for (const f of facts.filter((f2) => f2.kind === "billing" && f2.currency === "ARS" && f2.minor > 0)) {
    const row = buckets.get(periodOf(f.cycleMonth ?? f.effectiveDate.slice(0, 7), scope.granularity));
    if (row) row.base += f.minor / 100;
  }
  return { periods: [...buckets.values()].map(({ native, base, ...row }) => ({ ...row, pctOfSpend: base > 0 ? native / base * 100 : null })).sort((a, b) => a.period.localeCompare(b.period)), top: items.sort((a, b) => b.amount - a.amount).slice(0, 12) };
}
function floatModel(facts, statements, scope, rates) {
  const months = Object.keys(rates.cpi).sort();
  if (!months.length) throw new AccountingError("reference_data_missing");
  const base = rates.cpi[months.at(-1)];
  const cpi = (month) => month <= months[0] ? rates.cpi[months[0]] : monthValue(month, rates.cpi, CPI_REMEDY);
  const groups = /* @__PURE__ */ new Map();
  for (const f of billedObservations(facts).filter((r) => r.currency === "ARS" && r.minor > 0)) {
    const due = statements.find((s) => s.id === f.statementId)?.dueDate ?? `${f.month}-28`, days = (Date.parse(due + "T00:00:00Z") - Date.parse(f.date + "T00:00:00Z")) / 864e5;
    if (days < 0) continue;
    const amount = f.minor / 100, purchase = amount * base / cpi(f.date.slice(0, 7)), gain = purchase - amount * base / cpi(due.slice(0, 7)), period = periodOf(f.month, scope.granularity), i = f.financed ? 1 : 0;
    const row = groups.get(period) ?? { days: [0, 0], weight: [0, 0], gain: [0, 0], purchase: 0 };
    row.days[i] += days * amount;
    row.weight[i] += amount;
    row.gain[i] += gain;
    row.purchase += purchase;
    groups.set(period, row);
  }
  return [...groups].map(([period, row]) => {
    const gain = row.gain[0] + row.gain[1], weight = row.weight[0] + row.weight[1];
    return { period, avgDays: (row.days[0] + row.days[1]) / weight, avgDaysOneOff: row.weight[0] ? row.days[0] / row.weight[0] : null, avgDaysInstallment: row.weight[1] ? row.days[1] / row.weight[1] : null, gainOneOff: row.gain[0], gainInstallment: row.gain[1], gain, gainPct: row.purchase > 0 ? gain / row.purchase * 100 : 0 };
  }).sort((a, b) => a.period.localeCompare(b.period));
}
function installmentModel(facts, statements, scope, rates) {
  const rows = billedObservations(facts), groups = /* @__PURE__ */ new Map();
  for (const { fact: f, amount, period } of valuedFacts(facts, { ...scope, basis: "billed", period: null }, rates)) {
    const row = groups.get(period) ?? { period, installment: 0, oneOff: 0, plans: /* @__PURE__ */ new Set(), unknownPlans: false };
    if (f.financed) {
      row.installment += amount;
      if (f.purchaseId) row.plans.add(f.purchaseId);
      else row.unknownPlans = true;
    } else row.oneOff += amount;
    groups.set(period, row);
  }
  const latest = /* @__PURE__ */ new Map();
  for (const s of statements.filter((s2) => s2.current)) if (!latest.has(s.cardId) || latest.get(s.cardId).closingDate < s.closingDate) latest.set(s.cardId, s);
  const plans = [];
  for (const f of rows) {
    const count = f.installmentCount, number = f.installmentNumber;
    if (f.currency !== "ARS" || !count || !number || number >= count || f.statementId !== latest.get(f.cardId)?.id) continue;
    const monthly = valueArs(f.minor / 100, f.month, scope, rates);
    plans.push({ merchant: f.merchant, brand: f.cardId, paid: number, total: count, monthly, remainingMonths: count - number, remainingTotal: monthly * (count - number) });
  }
  return { burden: [...groups.values()].map((row) => ({ period: row.period, installment: row.installment, oneOff: row.oneOff, plans: row.unknownPlans ? null : row.plans.size, sharePct: row.installment + row.oneOff > 0 ? row.installment / (row.installment + row.oneOff) * 100 : 0 })).sort((a, b) => a.period.localeCompare(b.period)), plans: plans.sort((a, b) => b.remainingTotal - a.remainingTotal) };
}
function bankModel(statements, scope, rates) {
  const active = statements.filter((s) => s.current), cards = new Set(active.map((s) => s.cardId)), groups = /* @__PURE__ */ new Map();
  for (const s of active) {
    const row = groups.get(s.cycleMonth) ?? [];
    const prior = row.findIndex((r) => r.cardId === s.cardId);
    if (prior < 0) row.push(s);
    else if (row[prior].closingDate < s.closingDate) row[prior] = s;
    groups.set(s.cycleMonth, row);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => {
    const sum = (key) => rows.some((s) => s[key] !== null) ? rows.reduce((total, s) => signedSum(total, s[key] ?? 0), 0) / 100 : null;
    const limit = sum("purchaseLimitArsMinor"), ars = sum("balanceArsMinor"), usd = sum("balanceUsdMinor"), minimum = sum("minimumPaymentArsMinor"), balance = ars === null && usd === null ? null : (ars ?? 0) + (usd ?? 0) * (usd ? mepFor(month, rates.mep) : 1);
    const worst = rows.filter((s) => s.temPct !== null).sort((a, b) => b.temPct - a.temPct || a.cardId.localeCompare(b.cardId))[0], previous = addMonth(month, -1), inflation = rates.cpi[month] !== void 0 && rates.cpi[previous] !== void 0 ? (rates.cpi[month] / rates.cpi[previous] - 1) * 100 : null;
    return { month, limit: limit === null || rows.length < cards.size ? null : valueArs(limit, month, scope, rates), limitByBrand: Object.fromEntries(rows.map((s) => [s.cardId, s.purchaseLimitArsMinor === null ? null : valueArs(s.purchaseLimitArsMinor / 100, month, scope, rates)])), temByBrand: Object.fromEntries(rows.map((s) => [s.cardId, s.temPct])), balance: balance === null ? null : valueArs(balance, month, scope, rates), utilizationPct: limit && balance !== null ? balance / limit * 100 : null, minPaymentPct: minimum !== null && ars ? minimum / ars * 100 : null, temPct: worst?.temPct ?? null, temBrand: worst?.cardId ?? null, inflationPct: inflation, realTemPct: worst?.temPct !== null && worst?.temPct !== void 0 && inflation !== null ? ((1 + worst.temPct / 100) / (1 + inflation / 100) - 1) * 100 : null };
  });
}
function alertModel(facts, inspection, rates, locale = "en") {
  const rows = billedObservations(facts).filter((r) => !r.financed), alerts = [], states = new Map(inspection.alertStates?.map((s) => [s.id, s.state]) ?? []);
  for (const cardId of new Set(rows.map((r) => r.cardId))) {
    const cardRows = rows.filter((r) => r.cardId === cardId), statements = [...new Set(cardRows.map((r) => r.statementId ?? r.month))];
    const input = cardRows.map((r) => ({ statement_id: statements.indexOf(r.statementId ?? r.month), merchant: r.merchant, month: r.month, date: r.date, ars: r.ars, usd: r.usd, installment_count: r.installmentCount }));
    for (const alert of detectAnomalies(input, rates.cpi)) {
      const anchors = cardRows.filter((r) => r.merchant === alert.merchant && r.month === alert.month).map((r) => r.purchaseId ?? r.id).sort();
      const key = `computed:${createHash("sha256").update(JSON.stringify([cardId, alert.kind, anchors])).digest("hex")}`;
      alerts.push({ key, source: "anomaly", kind: alert.kind, month: alert.month, date: alert.date, merchant: alert.merchant, amount: alert.amount, message: alert.message, messageKey: alert.messageKey, messageParams: alert.messageParams, state: states.get(key) ?? (alert.resolved ? "reviewed" : "open") });
    }
  }
  for (const event of inspection.reviews ?? []) {
    if (event.code === "receipt_item_identity_reviewed" || event.code === "historical_source_classification") continue;
    if ((inspection.reviews ?? []).some((child) => child.priorDecisionId === event.id)) continue;
    const key = `retained:${event.subjectId}:${event.code}`, source = inspection.sources?.find((s) => s.id === event.subjectId), month = source?.closingDate?.slice(0, 7) ?? source?.recordedAt.slice(0, 7) ?? event.recordedAt.slice(0, 7);
    alerts.push({ key, source: "integrity", kind: event.code, month, date: null, merchant: null, amount: null, message: `${(locale === "es" ? commitmentSpanish : commitmentEnglish)[event.code === "receipt_has_historical_association" ? "accounting.commitment.reviewAssociation" : /opening|historical/.test(event.code) ? "accounting.commitment.reviewOpening" : "accounting.commitment.reviewEvidence"]} (${event.code})${Object.keys(event.params).length ? ` \xB7 ${JSON.stringify(event.params)}` : ""}`, state: states.get(key) ?? event.state });
  }
  for (const retained of inspection.alertStates ?? []) {
    if (!retained.source || alerts.some((alert) => alert.key === retained.id)) continue;
    const source = retained.source;
    const month = (source.legacyKey ?? retained.id).match(/\d{4}-(?:0[1-9]|1[0-2])/)?.[0] ?? "";
    alerts.push({ key: retained.id, source: "integrity", kind: source.kind, month, date: null, merchant: null, amount: null, message: source.message, state: retained.state });
  }
  return [...new Map(alerts.map((a) => [a.key, a])).values()].sort((a, b) => b.month.localeCompare(a.month) || a.key.localeCompare(b.key));
}
function commitmentsData(input) {
  const { facts, statements, schedules, inspection, scope, rates, locale } = input, recurring = recurringModel(facts, rates), billed = billedObservations(facts), months = [.../* @__PURE__ */ new Set([...billed.map((r) => r.month), ...statements.filter((s) => s.current).map((s) => s.cycleMonth)])].sort(), latest = months.at(-1);
  const activeNames = new Set(recurring.filter((r) => r.currency === "ARS" && r.status === "active" && r.confidence === "high").map((r) => r.merchant)), history = new Map(months.slice(-6).map((month) => [month, 0]));
  for (const { fact, month, amount } of valuedFacts(facts, { ...scope, basis: "billed", period: null }, rates)) {
    if (fact.installmentCount != null || activeNames.has(fact.merchant ?? "")) continue;
    if (history.has(month)) history.set(month, history.get(month) + amount);
  }
  const schedulesValued = schedules.map((s) => ({ ...s, amount: latest ? valueArs(s.amount, latest, scope, rates) : s.amount })), recurringValued = recurring.map((r) => ({ ...r, lastAmount: r.currency === "ARS" ? valueArs(r.lastAmount, r.lastMonth, scope, rates) : r.lastAmount }));
  const forecast = latest ? commitmentModel({ schedules: schedulesValued, recurring: recurringValued, variableHistory: [...history.values()], startMonth: addMonth(latest), inflation: trailingMonthlyInflation(rates.cpi), value: scope.value }) : { forecast: [], remainingPrincipal: 0 };
  const alerts = alertModel(facts, inspection, rates, locale), spending = spendRows(facts, { ...scope, granularity: "month", period: null }, rates), totals = /* @__PURE__ */ new Map();
  for (const r of spending) totals.set(r.period, (totals.get(r.period) ?? 0) + r.amount);
  const sorted = [...totals].sort(([a], [b]) => a.localeCompare(b)), last = sorted.at(-1), previous = sorted.at(-2), topCategories = spending.filter((r) => r.period === last?.[0]).sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => ({ category: r.accountId, amount: r.amount }));
  const latestStatement = statements.filter((s) => s.current).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0], first = forecast.forecast[0];
  return { recurring, inflation: inflationModel(facts, rates), taxes: taxesModel(facts, scope, rates), credits: creditsModel(facts, scope, rates), float: floatModel(facts, statements, scope, rates), installments: installmentModel(facts, statements, scope, rates), forecast: forecast.forecast, bank: bankModel(statements, scope, rates), realBank: bankModel(statements, { ...scope, value: "real" }, rates), alerts, cleared: inspection.alertStates?.filter((s) => !alerts.some((a) => a.key === s.id)).length ?? 0, totals: sorted.map(([period, amount]) => ({ period, amount })), coverage: { cards: inspection.cards.length, scheduleCards: new Set(statements.filter((s) => s.current && !statements.some((newer) => newer.current && newer.cardId === s.cardId && newer.closingDate > s.closingDate)).filter((s) => {
    const raw = inspection.sources?.find((source) => source.id === s.id)?.rawPayload;
    return raw !== null && typeof raw === "object" && Array.isArray(raw.upcoming_installments);
  }).map((s) => s.cardId)).size, uncertain: facts.filter((f) => f.coverage !== "complete").length }, overview: { spentThisMonth: last?.[1] ?? 0, pctVsPrev: previous?.[1] ? (last[1] - previous[1]) / previous[1] * 100 : null, openAlerts: alerts.filter((a) => a.state === "open"), nextStatementForecast: first ?? { certain: 0, expected: 0, estLow: 0, estHigh: 0 }, topCategories, installmentMonths: new Set(schedules.filter((s) => s.current).map((s) => s.month)).size, installmentTotal: forecast.remainingPrincipal, sparkline: sorted.slice(-12).map(([month, amount]) => ({ month, amount })), latestClosing: latestStatement?.closingDate ?? null, nextDueDate: latestStatement?.dueDate ?? null, baseMonth: Object.keys(rates.cpi).sort().at(-1) ?? "" } };
}
export {
  alertModel,
  bankModel,
  billedObservations,
  commitmentModel,
  commitmentsData,
  creditsModel,
  floatModel,
  inflationModel,
  installmentModel,
  recurringModel,
  taxesModel,
  valueArs
};
