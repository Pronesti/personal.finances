import { Pool, type PoolClient } from "pg";
import { retainedReceiptItemAllocations } from "./linking";
import type { ReceiptLinkDecision } from "./evidence-port";
import { currentHistoricalAssociations, type HistoricalReceiptAssociation } from "./historical-links";
import { historicalAcquisitionFacts, applyHistoricalClassifications, receiptBackedHistoricalAcquisitions } from "./historical-analytics";
import { accountingSchema } from "./postgres";
import { AccountingError, type PurchaseVersion, type Billing, type Journal, type Account, type AttributionState, type OpeningObligation } from "./model";
import { splitMinor } from "./purchases";
import { normalizeMerchant } from "../categorize";
import { validDate } from "./journal";
import { purposeMeasuresFromSnapshot } from "./reports/spending";
import { AccountingCapabilityError, validateReportFacts, type AccountingReader, type ReportFact, type StatementFact, type ScheduleFact, type PurposeSnapshot, type ReceiptFact, type ItemFact, type RawReceiptItemFact, type AccountingInspection, type ReceiptAllocationFact } from "./read-model";

type JournalRow = { id: string; card_id: string; currency: "ARS" | "USD"; effective_date: string; kind: string };
type LineRow = { journal_id: string; ordinal: number; account_id: string; purpose_id: string | null; purchase_id: string | null; debit_minor: string; credit_minor: string; type: string };
type SourceRow = { journal_id: string; line_id: string; revision_id: string; payload: { description?: string; installment_number?: number | null; installment_count?: number | null }; closing_date: string | null; period: { previous_closing_date?: string | null } | null };
export function reportMinor(value: unknown): number {
  const result = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isSafeInteger(result)) throw new AccountingError("invalid_minor_units");
  return result;
}
function sourceMinor(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AccountingError("invalid_source_amount");
  const scaled = value * 100, result = Math.round(scaled);
  if (!Number.isSafeInteger(result) || Math.abs(result-scaled)>0.000001) throw new AccountingError("invalid_source_amount");
  return result;
}
function cycle(closing: string, previous: string | null | undefined): string {
  const end = Date.parse(closing+"T00:00:00Z"), start = previous ? Date.parse(previous+"T00:00:00Z") : end-30*86400_000;
  if (!validDate(closing) || previous && !validDate(previous)) throw new AccountingError("invalid_report_date");
  return new Date((start+end)/2).toISOString().slice(0,7);
}
export type FinancialRows = { journals: JournalRow[]; lines: LineRow[]; purchases: PurchaseVersion[]; billings: Billing[]; openingObligations?: OpeningObligation[]; creditJournalIds: string[]; sources: SourceRow[] };
/** Current versions select actual immutable journals; reversals are never another acquisition. */
export function financialFacts(rows: FinancialRows): ReportFact[] {
  const journals = new Map(rows.journals.map(j=>[j.id,j])), source = new Map<string, SourceRow>();
  for (const row of rows.sources) if (!source.has(row.journal_id)) source.set(row.journal_id,row);
  const facts: ReportFact[] = [];
  const base = (j: JournalRow, purchaseId: string | null): Omit<ReportFact,"id"|"kind"|"minor"|"accountId"|"purposeId"> => {
    const s = source.get(j.id), originalSource=source.get(rows.purchases.find(p=>p.purchaseId===purchaseId)?.journalId ?? "");
    const merchant = s?.payload.description ?? originalSource?.payload.description;
    return { origin:"ledger",journalId:j.id,description:s?.payload.description??null,installmentNumber:s?.payload.installment_number??null,installmentCount:s?.payload.installment_count??null,purchaseId, cardId:j.card_id, currency:j.currency, effectiveDate:j.effective_date, merchant:merchant ? normalizeMerchant(merchant) : null, sourceLineId:s?.line_id??null, statementId:s?.revision_id??null, cycleMonth:s?.closing_date ? cycle(s.closing_date,s.period?.previous_closing_date) : null, coverage:j.kind==="opening"?"opening":s?"complete":"uncertain" };
  };
  const appendExpense = (journalId:string, kind:ReportFact["kind"], purchaseId:string|null) => {
    const j=journals.get(journalId); if(!j) throw new AccountingError("report_journal_missing");
    for(const line of rows.lines.filter(l=>l.journal_id===journalId && l.type==="expense")) {
      const minor=reportMinor(reportMinor(line.debit_minor)-reportMinor(line.credit_minor));
      facts.push({...base(j,purchaseId??line.purchase_id),id:`${j.id}:${line.ordinal}`,kind,accountId:line.account_id,purposeId:line.purpose_id,minor});
    }
  };
  for(const p of rows.purchases) appendExpense(p.journalId,"purchase",p.purchaseId);
  for(const id of rows.creditJournalIds) appendExpense(id,"credit",rows.lines.find(l=>l.journal_id===id && l.purchase_id)?.purchase_id??null);
  for(const billing of rows.billings) {
    const j=journals.get(billing.journalId); if(!j) throw new AccountingError("report_journal_missing");
    if (billing.origin === "opening_balance") continue;
    if (billing.openingObligationId) {
      const obligation = rows.openingObligations?.find(item => item.id === billing.openingObligationId);
      if (!obligation) throw new AccountingError("report_opening_obligation_missing");
      const shares = splitMinor(billing.amountMinor, obligation.allocations.map(item => item.minor));
      obligation.allocations.forEach((allocation, index) => {
        if (shares[index]) facts.push({ ...base(j, null), id: `${j.id}:opening-billing:${index}`, kind: "billing", accountId: "expense:unallocated", purposeId: allocation.purposeId, minor: shares[index], purchaseDate: obligation.purchaseDate, installmentNumber: billing.installment, installmentCount: obligation.installmentCount, financed: true, cycleMonth: base(j, null).cycleMonth ?? j.effective_date.slice(0, 7) });
      });
      continue;
    }
    const p=rows.purchases.find(p=>p.purchaseId===billing.purchaseId);
    if(!p) continue; // Supported opening obligations are debt, never billed spending.
    // Allocate exact billed principal over the latest accepted allocation, preserving the sum.
    const shares=splitMinor(billing.amountMinor,p.allocations.map(a=>a.minor));
    p.allocations.forEach((allocation,i)=>{
      const accountLine=rows.lines.find(l=>l.journal_id===p.journalId && l.account_id===allocation.accountId && l.type==="expense");
      if(!accountLine || !shares[i]) return;
      facts.push({...base(j,p.purchaseId),id:`${j.id}:billing:${i}`,kind:"billing",purchaseDate:p.effectiveDate,installmentNumber:billing.installment,financed:p.principalMinor>billing.amountMinor||billing.installment>1||(base(j,p.purchaseId).installmentCount??0)>1,cycleMonth:base(j,p.purchaseId).cycleMonth??j.effective_date.slice(0,7),accountId:allocation.accountId,purposeId:allocation.purposeId,minor:reportMinor(shares[i])});
    });
  }
  for(const j of rows.journals) {
    if(j.kind==="cost") appendExpense(j.id,"cost",null);
    if(j.kind==="repayment" || j.kind==="opening") {
      const liability=rows.lines.filter(l=>l.journal_id===j.id && l.type==="liability");
      const minor=liability.reduce((sum,l)=>reportMinor(sum+reportMinor(l.credit_minor)-reportMinor(l.debit_minor)),0);
      facts.push({...base(j,null),id:`${j.id}:${j.kind}`,kind:j.kind==="repayment"?"payment":"opening",accountId:null,purposeId:null,minor:j.kind==="repayment"?-minor:minor});
    }
  }
  return validateReportFacts(facts).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.id.localeCompare(b.id));
}
export function applyMerchantAliases(facts:ReportFact[],merchants:import("./review").MerchantSubject[],associations:import("./review").MerchantPurchaseSubject[]):void {
  for(const fact of facts) {
    const association=associations.find(a=>a.purchaseId===fact.purchaseId && a.cardId===fact.cardId);
    const normalized=normalizeMerchant(fact.description??fact.merchant??"");
    let merchant=association?merchants.find(m=>m.id===association.merchantId):merchants.find(m=>m.normalizedName===normalized);
    if (!merchant?.redirectId) {
      const ordered=merchants.filter(m=>m.position!==undefined&&normalized.startsWith(m.normalizedName)).sort((a,b)=>a.position!-b.position!);
      merchant=ordered[0]??merchant;
    }
    if(!merchant)continue;
    const seen=new Set<string>();
    while(merchant?.redirectId) {if(seen.has(merchant.id))throw new AccountingError("merchant_alias_cycle");seen.add(merchant.id);merchant=merchants.find(m=>m.id===merchant!.redirectId);}
    if(!merchant)throw new AccountingError("merchant_identity_missing");
    fact.merchant=merchant.displayName??merchant.normalizedName;
  }
}
export function issuerObservationFacts(backed:ReportFact[],statements:StatementFact[],lines:import("./evidence-port").SourceLine[]):ReportFact[] {
 const observations:ReportFact[]=[];
 for(const line of lines) {
  const statement=statements.find(s=>s.id===line.revisionId&&s.current);if(!statement)continue;
  const payload=line.payload as {section?:string;description?:string;date?:string|null;ars?:number|null;usd?:number|null;installment_number?:number|null;installment_count?:number|null};
  for(const [field,currency] of [["ars","ARS"],["usd","USD"]] as const) {
   const minor=sourceMinor(payload[field]);if(minor===null||minor===0)continue;
   const ownPayment=payload.section==="payments"&&/^(SU PAGO|PAGO RECIBIDO|PAGO DE RESUMEN|PAGO DE TARJETA|PAGO DEL RESUMEN|PAGO DE)\b/i.test(payload.description??"");
   const kind:ReportFact["kind"]|null=payload.section==="purchases"?(minor<0?"credit":"billing"):payload.section==="taxes_and_charges"?"cost":ownPayment?"payment":payload.section==="payments"&&minor<0?"credit":null;
   if(!kind||backed.some(f=>f.sourceLineId===line.id&&f.currency===currency&&f.kind===kind))continue;
   const date=payload.date&&validDate(payload.date)?payload.date:statement.closingDate;
   observations.push({id:JSON.stringify(["issuer",line.id,currency,kind]),origin:"issuer_observation",sourceSection:payload.section,purchaseId:null,cardId:statement.cardId,kind,merchant:payload.description?normalizeMerchant(payload.description):null,description:payload.description??null,accountId:kind==="billing"||kind==="credit"?"expense:unallocated":null,purposeId:kind==="billing"||kind==="credit"?"unallocated":null,currency,minor:kind==="payment"?Math.abs(minor):minor,effectiveDate:kind==="billing"?statement.closingDate:date,purchaseDate:payload.date&&validDate(payload.date)?payload.date:undefined,cycleMonth:statement.cycleMonth,sourceLineId:line.id,statementId:statement.id,coverage:"uncertain",installmentNumber:payload.installment_number??null,installmentCount:payload.installment_count??null,financed:(payload.installment_count??0)>1});
  }
 }
 return observations;
}
type Snapshot = { facts: ReportFact[]; statements: StatementFact[]; schedules: ScheduleFact[]; purpose: PurposeSnapshot; receipts: { receipts: ReceiptFact[]; items: ItemFact[]; rawItems: RawReceiptItemFact[] } | null; inspection: AccountingInspection; allocations: ReceiptAllocationFact[] | null };
async function readSnapshot(client:PoolClient):Promise<Snapshot> {
  const journals=(await client.query("SELECT id,card_id,currency,effective_date::text,kind,command_key,recorded_at,reverses_id,ARRAY(SELECT evidence_id FROM journal_evidence e WHERE e.journal_id=journals.id ORDER BY evidence_id) AS evidence_ids FROM journals WHERE status='posted' ORDER BY effective_date,id")).rows as JournalRow[];
  const lines=(await client.query("SELECT l.*,a.type FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.status='posted' ORDER BY l.journal_id,l.ordinal")).rows as LineRow[];
  const purchases=(await client.query("SELECT DISTINCT ON(purchase_id) payload FROM purchase_versions ORDER BY purchase_id,version DESC")).rows.map(r=>r.payload as PurchaseVersion);
  const billings=(await client.query("SELECT payload FROM billings ORDER BY id")).rows.map(r=>r.payload as Billing);
  const openingObligations:OpeningObligation[]=(await client.query("SELECT to_regclass('opening_obligations') AS present")).rows[0].present ? (await client.query("SELECT payload FROM opening_obligations ORDER BY id")).rows.map(row=>row.payload) : [];
  const creditJournalIds=(await client.query("SELECT coalesce((SELECT replacement_journal_id FROM credit_revisions r WHERE r.credit_id=c.id ORDER BY purchase_version DESC LIMIT 1),c.journal_id) AS id FROM linked_credits c UNION SELECT j.id FROM journals j WHERE j.kind='credit' AND j.status='posted' AND NOT EXISTS(SELECT 1 FROM linked_credits c WHERE c.journal_id=j.id) ORDER BY id")).rows.map(r=>r.id as string);
  const sources=(await client.query(`SELECT j.id AS journal_id,sl.id AS line_id,sl.revision_id,sl.payload,c.closing_date::text,c.period
    FROM journals j JOIN journal_evidence e ON e.journal_id=j.id JOIN source_lines sl ON sl.id=e.evidence_id
    JOIN source_revisions r ON r.id=sl.revision_id LEFT JOIN statement_cycles c ON c.revision_id=r.id
    WHERE j.status='posted' ORDER BY j.id,r.ordinal DESC,sl.id`)).rows as SourceRow[];
  const statementRows=(await client.query(`SELECT c.revision_id,c.card_id,c.closing_date::text,c.period,t.payload,
    NOT EXISTS(SELECT 1 FROM source_revisions newer WHERE newer.source_key=r.source_key AND newer.ordinal>r.ordinal AND newer.payload->>'admission'='accepted') AND r.payload->>'admission'='accepted' AS current
    FROM statement_cycles c JOIN source_revisions r ON r.id=c.revision_id JOIN statement_terms t ON t.revision_id=c.revision_id ORDER BY c.closing_date,c.card_id,c.revision_id`)).rows;
  const statements:StatementFact[]=statementRows.map(row=>{
    const period=row.period, terms=row.payload;
    return {id:row.revision_id,cardId:row.card_id,sourceRevisionId:row.revision_id,current:row.current,closingDate:row.closing_date,previousClosingDate:period.previous_closing_date??null,dueDate:period.due_date??null,cycleMonth:cycle(row.closing_date,period.previous_closing_date),balanceArsMinor:sourceMinor(terms.balances?.current_ars),balanceUsdMinor:sourceMinor(terms.balances?.current_usd),previousBalanceArsMinor:sourceMinor(terms.balances?.previous_ars),minimumPaymentArsMinor:sourceMinor(terms.balances?.minimum_payment_ars),purchaseLimitArsMinor:sourceMinor(terms.limits?.purchase),tnaPct:terms.rates?.annual_nominal_ars??null,temPct:terms.rates?.monthly_effective_ars??null};
  });
  const schedules:ScheduleFact[]=(await client.query("SELECT revision_id,payload FROM issuer_schedules ORDER BY revision_id,ordinal")).rows.map(row=>{
    const statement=statements.find(s=>s.sourceRevisionId===row.revision_id);if(!statement)throw new AccountingError("schedule_statement_missing");
    const minor=sourceMinor(row.payload.amount_ars);if(minor===null)throw new AccountingError("schedule_amount_missing");
    return {cardId:statement.cardId,revisionId:row.revision_id,current:statement.current && !statements.some(s=>s.current && s.cardId===statement.cardId && s.closingDate>statement.closingDate),month:row.payload.month,amount:minor/100};
  });
  const accounts:Account[]=(await client.query('SELECT id,parent_id AS "parentId",type,label_key AS "labelKey",custom_name AS "customName",currency,primary_purpose_id AS "primaryPurposeId",posting,enabled FROM accounts')).rows;
  const nativeJournals:Journal[]=journals.map(j=>{
    const raw=j as JournalRow & {command_key:string;recorded_at:string|Date;reverses_id:string|null;evidence_ids:string[]};
    return {id:j.id,commandKey:raw.command_key,cardId:j.card_id,currency:j.currency,effectiveDate:j.effective_date,recordedAt:raw.recorded_at instanceof Date ? raw.recorded_at.toISOString() : new Date(raw.recorded_at).toISOString(),kind:j.kind as Journal["kind"],reversesId:raw.reverses_id,evidenceIds:raw.evidence_ids,lines:lines.filter(l=>l.journal_id===j.id).map(l=>({accountId:l.account_id,purchaseId:l.purchase_id,purposeId:l.purpose_id,debitMinor:reportMinor(l.debit_minor),creditMinor:reportMinor(l.credit_minor)}))};
  });
  for(const journal of nativeJournals) {
    let debit=0,credit=0;
    for(const line of journal.lines) { if(line.debitMinor<0 || line.creditMinor<0) throw new AccountingError("invalid_minor_units"); debit=reportMinor(debit+line.debitMinor);credit=reportMinor(credit+line.creditMinor); }
    if(!debit || debit!==credit) throw new AccountingError("unbalanced_journal");
  }
  const reviewAvailable=(await client.query("SELECT to_regclass('merchant_revisions') AS merchants,to_regclass('product_match_revisions') AS matches,to_regclass('receipt_entities') AS receipts")).rows[0];
  const retainedLines=(await client.query('SELECT id,revision_id AS "revisionId",occurrence,payload,legacy_fingerprint AS "legacyFingerprint" FROM source_lines ORDER BY revision_id,occurrence')).rows;
  const facts=financialFacts({journals,lines,purchases,billings,openingObligations,creditJournalIds,sources});
  facts.push(...issuerObservationFacts(facts,statements,retainedLines));
  facts.push(...historicalAcquisitionFacts(facts,statements,retainedLines,nativeJournals));
  validateReportFacts(facts);
  let retainedMerchants:import("./review").MerchantSubject[] = [], retainedMerchantPurchases:import("./review").MerchantPurchaseSubject[] = [];
  if(reviewAvailable.merchants) {
    const merchants=(await client.query("SELECT DISTINCT ON(id) payload FROM merchant_revisions ORDER BY id,seq DESC")).rows.map(r=>r.payload as import("./review").MerchantSubject);
    const associations=(await client.query("SELECT DISTINCT ON(id) payload FROM merchant_purchase_revisions ORDER BY id,seq DESC")).rows.map(r=>r.payload as import("./review").MerchantPurchaseSubject);
    retainedMerchants=merchants;retainedMerchantPurchases=associations;
    applyMerchantAliases(facts,merchants,associations);
  }
  let receipts:Snapshot["receipts"]=null, allocations:ReceiptAllocationFact[]|null=null;
  const historicalAssociations:HistoricalReceiptAssociation[]=(await client.query("SELECT to_regclass('historical_receipt_associations') AS present")).rows[0].present ? (await client.query("SELECT payload FROM historical_receipt_associations ORDER BY ordinal")).rows.map(row=>row.payload) : [];
  if(reviewAvailable.receipts && reviewAvailable.matches) {
    const accepted=(await client.query(`SELECT DISTINCT ON(f.receipt_id) f.receipt_id::text,f.revision_id,f.payload FROM receipt_facts f JOIN source_revisions r ON r.id=f.revision_id WHERE r.payload->>'admission'='accepted' ORDER BY f.receipt_id,r.ordinal DESC`)).rows;
    const receiptAcquisitions=receiptBackedHistoricalAcquisitions(facts,currentHistoricalAssociations(historicalAssociations),accepted.map(row=>row.payload),statements,retainedLines,nativeJournals);
    applyMerchantAliases(receiptAcquisitions,retainedMerchants,retainedMerchantPurchases);facts.push(...receiptAcquisitions);validateReportFacts(facts);
    const products=(await client.query("SELECT DISTINCT ON(product_id) product_id::text,payload FROM product_revisions ORDER BY product_id,seq DESC")).rows;
    const matches=(await client.query("SELECT DISTINCT ON(id) payload FROM product_match_revisions ORDER BY id,seq DESC")).rows.map(r=>r.payload as import("./review").MatchSubject);
    const identityEvents=(await client.query("SELECT subject_id,state FROM review_events e WHERE e.code='receipt_item_identity_reviewed' AND NOT EXISTS(SELECT 1 FROM review_events child WHERE child.prior_decision_id=e.id)")).rows;
    const reviewedIdentity=(id:string)=>identityEvents.filter(e=>e.subject_id===id).length===1 && identityEvents.find(e=>e.subject_id===id)?.state==="reviewed";
    const sourceLines=(await client.query("SELECT id,revision_id,payload FROM source_lines WHERE revision_id IN(SELECT revision_id FROM receipt_facts)")).rows;
    receipts={receipts:[],items:[],rawItems:[]};
    for(const row of accepted) {
      const data=row.payload as import("./evidence-port").ReceiptFacts,id=reportMinor(row.receipt_id);
      if(data.receiptId!==id || id<=0 || !data.date || !validDate(data.date)) throw new AccountingError("invalid_receipt_identity");
      receipts.receipts.push({id,date:data.date,time:data.parsed.header.time,subtotalCents:reportMinor(data.parsed.footer.subtotalCents),discountsCents:reportMinor(data.parsed.footer.discountsCents),totalCents:reportMinor(data.totalMinor)});
      for (const sourceLine of sourceLines.filter(line => line.revision_id === row.revision_id)) {
        const item = sourceLine.payload as import("../receipts/parse").ParsedItem;
        receipts.rawItems.push({sourceLineId:sourceLine.id,receiptId:id,qtyMilli:reportMinor(item.qtyMilli),grossCents:reportMinor(item.lineTotalCents),discountCents:item.discounts.reduce((sum,d)=>reportMinor(sum+reportMinor(d.amountCents)),0),hasM:item.discounts.some(d=>d.tag==="M"),hasA:item.discounts.some(d=>d.tag==="A")});
      }
      for(const match of matches.filter(m=>m.receiptRevisionId===row.revision_id && m.reviewed && reviewedIdentity(m.sourceLineId))) {
        const productRow=products.find(p=>p.product_id===match.productId),product=productRow?.payload as import("./review").ProductSubject|undefined;
        if(!product || !product.reviewed || product.redirectId)continue;
        if(product.id!==productRow.product_id)throw new AccountingError("invalid_product_identity");
        const line=sourceLines.find(l=>l.id===match.sourceLineId && l.revision_id===row.revision_id);
        if(!line)throw new AccountingError("receipt_item_missing");
        const item=line.payload as import("../receipts/parse").ParsedItem;
        const discounts=item.discounts.reduce((sum,d)=>reportMinor(sum+reportMinor(d.amountCents)),0);
        receipts.items.push({receiptId:id,productId:reportMinor(product.id),productName:product.name,category:product.category,unit:product.unit,qtyMilli:reportMinor(item.qtyMilli),grossCents:reportMinor(item.lineTotalCents),discountCents:discounts,hasM:item.discounts.some(d=>d.tag==="M"),hasA:item.discounts.some(d=>d.tag==="A")});
      }
    }
    receipts.receipts.sort((a,b)=>a.date.localeCompare(b.date)||(a.time??"").localeCompare(b.time??"")||a.id-b.id);
    const decisions=(await client.query("SELECT receipt_revision_id,payload FROM receipt_link_decisions ORDER BY receipt_revision_id,id")).rows as {receipt_revision_id:string;payload:ReceiptLinkDecision}[];
    const superseded=new Set(decisions.map(row=>row.payload.previousDecisionId));
    const links=decisions.filter(row=>row.payload.action==='link'&&!superseded.has(row.payload.id));
    allocations=[];
    for(const fact of facts) fact.receiptIds=[...new Set(links.filter(link=>link.payload.purchaseId===fact.purchaseId).flatMap(link=>accepted.filter(r=>r.revision_id===link.receipt_revision_id).map(r=>reportMinor(r.receipt_id))))];
    for (const association of currentHistoricalAssociations(historicalAssociations)) {
      const receipt = accepted.find(row => row.revision_id === association.receiptRevisionId);
      if (!receipt) continue;
      for (const fact of facts.filter(fact => fact.sourceLineId === association.sourceLineId)) fact.receiptIds = [...new Set([...(fact.receiptIds ?? []), reportMinor(receipt.receipt_id)])];
    }
    for (const billing of billings.filter(billing => billing.openingObligationId)) {
      const obligation = openingObligations.find(obligation => obligation.id === billing.openingObligationId);
      if (!obligation) continue;
      const ids = accepted.filter(receipt => obligation.evidenceIds.includes(receipt.revision_id)).map(receipt => reportMinor(receipt.receipt_id));
      for (const fact of facts.filter(fact => fact.journalId === billing.journalId)) fact.receiptIds = [...new Set([...(fact.receiptIds ?? []), ...ids])];
    }
    for(const link of links) {
      const receipt=accepted.find(r=>r.revision_id===link.receipt_revision_id);if(!receipt)continue;
      const itemAllocations=retainedReceiptItemAllocations(decisions.filter(row=>row.receipt_revision_id===link.receipt_revision_id).map(row=>row.payload),link.payload.purchaseId);
      if(!Array.isArray(itemAllocations)) {allocations=null;break;}
      for(const allocation of itemAllocations) {
        const line=sourceLines.find(l=>l.id===allocation.sourceLineId && l.revision_id===link.receipt_revision_id);
        if(!line)throw new AccountingError("receipt_item_missing");
        const item=line.payload as import("../receipts/parse").ParsedItem;
        const net=item.discounts.reduce((sum,d)=>reportMinor(sum+reportMinor(d.amountCents)),reportMinor(item.lineTotalCents));
        if(net!==reportMinor(allocation.minor))throw new AccountingError("receipt_allocation_mismatch");
        allocations.push({receiptId:reportMinor(receipt.receipt_id),itemId:allocation.sourceLineId,accountId:allocation.accountId,purposeId:allocation.purposeId,netMinor:net,reviewed:reviewedIdentity(allocation.sourceLineId)});
      }
    }
  }
  const state:AttributionState={billings,payments:(await client.query("SELECT payload FROM payments ORDER BY id")).rows.map(r=>r.payload),credits:(await client.query("SELECT coalesce((SELECT r.payload FROM credit_revisions r WHERE r.credit_id=c.id ORDER BY purchase_version DESC LIMIT 1),c.payload) AS payload FROM linked_credits c ORDER BY c.id")).rows.map(r=>r.payload),
    attributions:(await client.query('SELECT id,payment_id AS "paymentId",component_id AS "componentId",purpose_id AS "purposeId",minor::text,method,revision FROM attributions')).rows.map(r=>({...r,minor:reportMinor(r.minor)} as AttributionState["attributions"][number])),
    attributionRevisions:(await client.query('SELECT payment_id AS "paymentId",revision,unapplied_minor::text AS "unappliedMinor" FROM attribution_revisions')).rows.map(r=>({...r,unappliedMinor:reportMinor(r.unappliedMinor)})),
    componentRevisions:(await client.query('SELECT id,component_id AS "componentId",billing_id AS "billingId",revision,purpose_id AS "purposeId",minor::text,purchase_date::text AS "purchaseDate" FROM component_revisions')).rows.map(r=>({...r,minor:reportMinor(r.minor)} as AttributionState["componentRevisions"][number]))};
  const cards=(await client.query("SELECT id FROM cards ORDER BY id")).rows.map(row=>({id:row.id,displayName:accounts.find(a=>a.id===`card:${row.id}`)?.customName??row.id}));
  const retainedSources=(await client.query("SELECT payload FROM source_revisions ORDER BY ordinal")).rows.map(r=>r.payload as import("./evidence-port").SourceRevision);
  const sourceLines=retainedLines;
  const reviews=(await client.query('SELECT id,subject_id AS "subjectId",prior_decision_id AS "priorDecisionId",code,params,source_line_ids AS "sourceLineIds",state,recorded_at AS "recordedAt" FROM review_events ORDER BY ordinal')).rows.map(r=>({...r,recordedAt:r.recordedAt instanceof Date?r.recordedAt.toISOString():r.recordedAt}));
  applyHistoricalClassifications(facts,reviews,accounts);
  const groups=(await client.query("SELECT DISTINCT ON(group_id) payload FROM account_group_revisions ORDER BY group_id,ordinal DESC")).rows.map(r=>r.payload as import("./catalog").AccountGroup);
  const alertStates=reviewAvailable.merchants ? (await client.query("SELECT DISTINCT ON(id) payload FROM alert_state_revisions ORDER BY id,seq DESC")).rows.map(r=>({id:r.payload.id,state:r.payload.state,source:r.payload.source})) : [];
  const reconstruction=(await client.query("SELECT to_regclass('reconstruction_reports') AS present")).rows[0].present ? (await client.query("SELECT p.payload,r.mode,r.cutoff_date::text FROM reconstruction_reports p JOIN reconstruction_runs r ON r.id=p.run_id ORDER BY r.created_at DESC LIMIT 1")).rows[0] : null;
  const openingCoverage=reconstruction && Array.isArray(reconstruction.payload.reconciliation) ? {mode:reconstruction.mode,cutoffDate:reconstruction.cutoff_date,unresolvedCount:reconstruction.payload.unresolved?.length??0,reconciliation:reconstruction.payload.reconciliation} : undefined;
  return {facts,statements,schedules,purpose:{journals:nativeJournals,accounts,purchases,state},receipts,inspection:{journals:nativeJournals,accounts,cards,groups,openingCoverage,historicalAssociations,merchants:retainedMerchants,merchantPurchases:retainedMerchantPurchases,sources:retainedSources,sourceLines,reviews,alertStates},allocations};
}
export function createPostgresReader(connectionString:string,schema="accounting"):AccountingReader {
  if(!connectionString)throw new AccountingError("missing_database_url"); accountingSchema(schema);
  const pool=new Pool({connectionString,connectionTimeoutMillis:5000});let pending:Promise<Snapshot>|undefined;
  const snapshot=()=>pending??=(async()=>{const client=await pool.connect();try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    const value=await readSnapshot(client);await client.query("COMMIT");return value;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}})();
  return {inspection:async()=>structuredClone((await snapshot()).inspection),purposeMeasures:async input=>purposeMeasuresFromSnapshot((await snapshot()).purpose,input),facts:async()=>structuredClone((await snapshot()).facts),statements:async()=>structuredClone((await snapshot()).statements),schedules:async()=>structuredClone((await snapshot()).schedules),receiptFacts:async()=>{const receipts=(await snapshot()).receipts;if(!receipts)throw new AccountingCapabilityError("receipt_facts");return structuredClone(receipts);},receiptAllocations:async()=>{const allocations=(await snapshot()).allocations;if(!allocations)throw new AccountingCapabilityError("receipt_allocations");return structuredClone(allocations);},close:async()=>{if(pending)await pending.catch(()=>{});await pool.end();}};
}
