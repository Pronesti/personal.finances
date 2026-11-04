import { billOpeningInstallmentTx } from "./opening-obligations";
import { currentHistoricalAssociations } from "./historical-links";
import { ordinaryPurchaseNature } from "./purchase-nature";
import { createHash, randomUUID } from "node:crypto";
import type { StatementJson } from "@/lib/integrity";
import { MAX_PDF_BYTES, safePdfName } from "@/lib/upload";
import { normalizeMerchant } from "@/lib/categorize";
import { fingerprintAll } from "@/lib/fingerprint";
import { AccountingError, type Currency, type PostResult } from "./model";
import { exactMinor, validDate } from "./journal";
import { identifyPurchase, retainSourceTx, sourceKey, sourceLineId, sourceAmountMinor, type PurchaseIdentityInput } from "./evidence";
import type { DocumentStore } from "./documents";
import type { EvidenceLedgerPort, EvidenceLedgerTx, ImportResult, ImportReview } from "./evidence-port";
import { registerMerchantPurchaseTx, classificationForMerchantTx } from "./review";
import { receiptPurchaseForStatement, reconcileReceiptTx } from "./linking";
import { billInstallmentTx, recordPurchaseTx, recordRepaymentTx, postJournalTx } from "./use-cases";
export type { ImportResult } from "./evidence-port";
export type StatementImportInput = { key: string; cardId: string; filename: string; pdf: Buffer; json: StatementJson; rawJson: Buffer; recordedAt: string; appRevision?: string; observationOnly?: boolean };
const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): string {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,order(v)])) : v;
  return JSON.stringify(order(value));
}
/** Exact source amounts are never rounded into an accounting fact. */
export const statementMinor = sourceAmountMinor;

function totalsConflict(json: StatementJson): boolean {
  for (const total of json.declared_totals ?? []) {
    for (const currency of ["ars","usd"] as const) {
      const printed = total[currency];
      if (printed === null || printed === undefined) continue;
      if (total.concept.startsWith("TOTAL CONSUMOS") && total.block !== null) {
        const actual = json.transactions.filter(t=>t.section==="purchases" && t.block===total.block).reduce((sum,t)=>sum+statementMinor(t[currency] ?? 0),0);
        if (!Number.isSafeInteger(actual) || actual!==statementMinor(printed)) return true;
      }
      if (total.concept==="SALDO ACTUAL") {
        const balance = json.balances?.[currency==="ars" ? "current_ars" : "current_usd"];
        if (balance !== undefined && balance !== null && statementMinor(balance)!==statementMinor(printed)) return true;
      }
    }
  }
  return false;
}
async function verifiedObject(documents: DocumentStore, bytes: Buffer) {
  const ref = await documents.put(bytes);
  if (ref.sha256!==sha(bytes) || ref.relativePath!==ref.sha256 || !(await documents.read(ref)).equals(bytes)) throw new AccountingError("document_hash_mismatch");
  return { ...ref, byteLength: bytes.byteLength };
}
export async function importStatement(port: EvidenceLedgerPort, documents: DocumentStore, input: StatementImportInput): Promise<ImportResult> {
  const name = safePdfName(input.filename);
  if (!input.key.trim() || !input.cardId.trim()) throw new AccountingError("missing_card_identity");
  if (input.pdf.byteLength>MAX_PDF_BYTES) throw new AccountingError("statement_too_large");
  if (input.pdf.subarray(0,5).toString("latin1")!=="%PDF-") throw new AccountingError("not_pdf");
  if (!validDate(input.json.period.closing_date) || !Array.isArray(input.json.transactions)) throw new AccountingError("invalid_statement");
  const appRevision = input.appRevision ?? process.env.ACCOUNTING_APP_REVISION;
  if (!appRevision?.trim()) throw new AccountingError("missing_app_revision");
  let raw: StatementJson;
  try { raw = JSON.parse(input.rawJson.toString("utf8")) as StatementJson; }
  catch { throw new AccountingError("invalid_raw_json"); }
  if (canonical({...raw,file:name})!==canonical({...input.json,file:name})) throw new AccountingError("source_payload_conflict");
  const json = { ...input.json, file: name };
  const documentHash = sha(input.pdf), commandKey = `card:${encodeURIComponent(input.cardId)}:statement:${encodeURIComponent(input.key)}`;
  const digest = sha(canonical({cardId:input.cardId,documentHash,json:{...json,file:null},observationOnly:input.observationOnly??false}));
  // Objects are immutable before admission. Rollback may leave reusable unreferenced objects.
  const pdfObject = await verifiedObject(documents,input.pdf), rawObject = await verifiedObject(documents,input.rawJson);
  return port.transaction(async tx => {
    const prior = await tx.sourceImportCommand(commandKey);
    if (prior) {
      if (prior.digest!==digest) throw new AccountingError("command_conflict");
      return { ...prior.result, postedJournalIds: [], duplicate: true };
    }
    // An actual card has configured native liability accounts; a brand alone never creates it.
    if (!await tx.account(`${input.cardId}:ARS:billed`) && !await tx.account(`${input.cardId}:USD:billed`)) throw new AccountingError("unknown_card");
    const key = sourceKey({cardId:input.cardId,kind:"statement",documentHash,fiscalId:null,closingDate:json.period.closing_date});
    const previous = await tx.sourceRevisions(key);
    const sameDocument=await tx.sourceByDocument("statement",documentHash);
    if(sameDocument && sameDocument.cardId!==input.cardId) throw new AccountingError("document_identity_conflict");
    const latest = previous.find(r=>!previous.some(child=>child.previousRevisionId===r.id))??sameDocument??undefined;
    const conflictingTotals = totalsConflict(json);
    const supportedIssuer = ["visa","mastercard","mercadopago"].includes(json.brand);
    await tx.appendSourceObject(pdfObject); await tx.appendSourceObject(rawObject);
    const retained = await retainSourceTx(tx,{key:input.key,cardId:input.cardId,kind:"statement",documentHash,objectPath:pdfObject.relativePath,rawPayload:json,previousRevisionId:latest?.id??null,recordedAt:input.recordedAt,fiscalId:null,closingDate:json.period.closing_date,rawObject,appRevision,admission:latest || conflictingTotals || !supportedIssuer ? "pending" : "accepted"});
    const result: ImportResult = {sourceRevisionId:retained.revisionId,purchaseIds:[],postedJournalIds:[],reviews:[],duplicate:retained.status==="duplicate"};
    if (retained.status==="duplicate") {
      // This also covers superseded bytes: observing an old object never promotes its revision.
      const reviews = await tx.reviewEvents(retained.revisionId);
      result.reviews = reviews.map(({code,params,sourceLineIds})=>({code,params,sourceLineIds}));
      await tx.appendSourceImportCommand({key:commandKey,digest,result}); return result;
    }
    const addReview = async (code: string, ids: string[], params: Record<string,string|number> = {}) => {
      const review: ImportReview = {code,params,sourceLineIds:ids}; result.reviews.push(review);
      await tx.appendReviewEvent({...review,id:randomUUID(),subjectId:retained.revisionId,priorDecisionId:null,state:"open",recordedAt:input.recordedAt});
    };
    const fingerprints = fingerprintAll(json.brand,json.transactions);
    for (let i=0;i<json.transactions.length;i++) await tx.appendSourceLine({id:sourceLineId(retained.revisionId,i+1),revisionId:retained.revisionId,occurrence:i+1,payload:{...json.transactions[i]},legacyFingerprint:fingerprints[i]});
    await tx.appendStatementFacts({revisionId:retained.revisionId,cardId:input.cardId,closingDate:json.period.closing_date,period:json.period,terms:{balances:json.balances??null,limits:json.limits??null,rates:json.rates??null,accountSummary:(json as StatementJson & {account_summary?:unknown}).account_summary??null},schedules:json.upcoming_installments??[]});
    if (latest) await addReview("source_revision_requires_review",[],{previousRevisionId:latest.id});
    if (conflictingTotals) await addReview("statement_totals_conflict",[]);
    if (!supportedIssuer) await addReview("unsupported_statement_layout",[]);
    if (!input.observationOnly && !latest && !conflictingTotals && supportedIssuer) {
      for (let i=0;i<json.transactions.length;i++) {
        const line = json.transactions[i], lineId = sourceLineId(retained.revisionId,i+1);
        if (line.ars !== null && line.usd !== null && line.ars !== 0 && line.usd !== 0 && !(line.section==="payments" && line.ars<0 && line.usd<0 && /^(SU PAGO|PAGO RECIBIDO|PAGO DEL? RESUMEN)\b/i.test(line.description))) { await addReview("ambiguous_dual_currency_line",[lineId]); continue; }
        for (const [field,currency] of [["ars","ARS"],["usd","USD"]] as const) {
          if (line[field] === null || line[field] === undefined) continue;
          const minor = statementMinor(line[field]);
          if (!minor) continue;
          if (!line.date || !validDate(line.date)) { await addReview("missing_effective_date",[lineId],{currency}); continue; }
          const openingDate = await tx.openingDate(input.cardId, currency);
          if (openingDate && json.period.closing_date <= openingDate) { await addReview("historical_source_requires_opening_reconciliation", [lineId], { currency, openingDate }); continue; }
          const common = {key:`statement:${lineId}:${currency}`,cardId:input.cardId,currency,effectiveDate:line.date,recordedAt:input.recordedAt,evidenceIds:[lineId]};
          const collect = async (post: PostResult) => {
            if (post.status==="posted") result.postedJournalIds.push(...post.journalIds);
            if (post.status==="review") await addReview(post.reviewCode??"financial_review",[lineId],{currency});
          };
          if (line.section==="payments" && minor<0 && /^(SU PAGO|PAGO RECIBIDO|PAGO DEL? RESUMEN)\b/i.test(line.description)) {
            await collect(await recordRepaymentTx(tx,{...common,amountMinor:exactMinor(-minor),issuerAllocations:null})); continue;
          }
          if (line.section==="purchases" && minor>0) {
            if (!ordinaryPurchaseNature(line.description)) { await addReview("unsupported_financial_nature",[lineId],{currency}); continue; }
            // Opening principal is supported debt, not a newly recognized acquisition.
            // Match retained original merchant/date/plan evidence; vouchers may change by cycle.
            if (openingDate && (line.installment_count??1)>1) {
              const candidates=[];
              for(const obligation of await tx.openingObligations(input.cardId,currency)) {
                if(obligation.installmentCount!==line.installment_count || Math.abs(Date.parse(obligation.purchaseDate)-Date.parse(line.date))>3*86400000) continue;
                let merchantSupported=false;
                for(const evidenceId of obligation.evidenceIds) {
                  const source=await tx.sourceLine(evidenceId);
                  if(source && typeof source.payload.description==="string" && normalizeMerchant(source.payload.description)===normalizeMerchant(line.description)) merchantSupported=true;
                }
                if(merchantSupported) candidates.push(obligation);
              }
              if(candidates.length>1) {await addReview("ambiguous_opening_obligation",[lineId],{currency});continue;}
              if(candidates.length===1) {
                await collect(await billOpeningInstallmentTx(tx,{...common,key:`${common.key}:opening-billing`,openingObligationId:candidates[0].id,installment:line.installment_number??0,amountMinor:minor,effectiveDate:json.period.closing_date}));
                continue;
              }
            }
            const voucher = (line as typeof line & {voucher?:string|null}).voucher ?? null;
            const identity: PurchaseIdentityInput = {cardId:input.cardId,currency,purchaseDate:line.date,voucher,installment:line.installment_number,installmentCount:line.installment_count,amountMinor:minor,sourceLineId:lineId};
            const receiptOrigin = await receiptPurchaseForStatement(tx,{cardId:input.cardId,currency,date:line.date,amountMinor:minor,description:line.description,installmentCount:line.installment_count,sourceLineId:lineId});
            if (receiptOrigin.reviewCode) { await addReview(receiptOrigin.reviewCode,[lineId],{currency}); continue; }
            const decision = receiptOrigin.purchaseId ? {status:"matched" as const,purchaseId:receiptOrigin.purchaseId,reason:"verified_receipt_origin"} : identifyPurchase(identity,await tx.purchaseIdentities(input.cardId,currency,line.date));
            if (decision.status==="review") { await addReview(decision.reason,[lineId],{currency}); continue; }
            if (decision.status==="new" && (line.installment_count??1)>1) { await addReview("missing_supported_principal",[lineId],{currency,installment:line.installment_number??0}); continue; }
            const purchaseId = decision.purchaseId ?? randomUUID();
            if (decision.status==="new") {
              const rule=await classificationForMerchantTx(tx,normalizeMerchant(line.description));
              const post = await recordPurchaseTx(tx,{...common,purchaseId,principalMinor:minor,allocations:[{accountId:rule?.accountId??"expense:unallocated",purposeId:rule?.purposeId??"unallocated",minor}]});
              await collect(post);
              if (post.status==="review") continue;
            }
            await tx.appendPurchaseIdentity({...identity,purchaseId});
            await registerMerchantPurchaseTx(tx,{purchaseId,cardId:input.cardId,normalizedName:normalizeMerchant(line.description),sourceLineId:lineId});
            if (!result.purchaseIds.includes(purchaseId)) result.purchaseIds.push(purchaseId);
            await collect(await billInstallmentTx(tx,{...common,key:`${common.key}:billing`,purchaseId,installment:line.installment_number??1,amountMinor:minor,effectiveDate:json.period.closing_date}));
            continue;
          }
          if (line.section==="taxes_and_charges" && minor>0 && /\b(INTER[EÉ]S|INTERESES|COMISI[OÓ]N|IVA|SELLOS|CARGO)\b/i.test(line.description)) {
            if (/IVA|PERCEPCI[OÓ]N|RETENCI[OÓ]N|IMPUESTO|RG\s*\d+/i.test(line.description)) { await addReview("tax_recoverability_review",[lineId],{currency}); continue; }
            const costAccount = /INTER[EÉ]S|INTERESES/i.test(line.description) ? "expense:financial:interest" : /SELLOS/i.test(line.description) ? "expense:financial:stamp" : /IVA/i.test(line.description) ? "expense:financial:taxes" : "expense:financial:fees";
            if (!await tx.account(costAccount)) { await addReview("missing_cost_account",[lineId],{currency,accountId:costAccount}); continue; }
            const journal = {id:randomUUID(),commandKey:common.key,cardId:common.cardId,currency,effectiveDate:common.effectiveDate,recordedAt:common.recordedAt,kind:"cost" as const,reversesId:null,evidenceIds:common.evidenceIds,lines:[{accountId:costAccount,debitMinor:minor,creditMinor:0,purchaseId:null,purposeId:"financial"},{accountId:`${input.cardId}:${currency}:billed`,debitMinor:0,creditMinor:minor,purchaseId:null,purposeId:null}]};
            await collect(await postJournalTx(tx,journal,sha(canonical({...journal,id:null,recordedAt:null})))); continue;
          }
          await addReview(minor<0 && line.section==="purchases" ? "unlinked_credit" : "unsupported_financial_nature",[lineId],{currency});
        }
      }
    }
    if (!input.observationOnly && !latest && !conflictingTotals && supportedIssuer) {
      const historicalReceipts=currentHistoricalAssociations(await tx.historicalAssociations());
      for (const receipt of await tx.acceptedReceipts()) {
        const historical=historicalReceipts.find(link=>link.receiptRevisionId===receipt.revisionId);
        if(historical&&receipt.date){
          const openingDate=await tx.openingDate(historical.cardId,historical.currency);
          if(openingDate&&receipt.date<=openingDate)continue;
        }
        const reconciled=await reconcileReceiptTx(tx,{key:`statement:${retained.revisionId}`,receiptRevisionId:receipt.revisionId,cardId:null,paymentVerified:false,purchaseId:null,allocation:null,recordedAt:input.recordedAt});
        for (const id of reconciled.purchaseIds) if (!result.purchaseIds.includes(id)) result.purchaseIds.push(id);
        result.postedJournalIds.push(...reconciled.postedJournalIds);
      }
    }
    await tx.appendSourceImportCommand({key:commandKey,digest,result}); return result;
  });
}
