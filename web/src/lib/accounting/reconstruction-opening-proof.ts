import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {sourceAmountMinor} from "./evidence";
import {validDate} from "./journal";
type Row={table:string;id:string;payload:Record<string,unknown>};
type ProofBilling={legacyTransactionId:number;fingerprint:string;statementId:number;issuerClosingDate:string;purchaseDate:string;currency:string;actualBilledMinor:number;installmentNumber:number|null;installmentCount:number|null;rawJsonPath:string;rawJsonSha256:string;rawTransactionOrdinal:number;voucher:string};
type ProofReceipt={legacyReceiptId:number;receiptDate:string;receiptFullPrincipalMinor:number;receiptPdfSha256:string;receiptPdfPath:string;receiptVerificationOk:boolean;acceptedLegacyAssociationFingerprint:string;cardId:string;actualOpeningIssuerStatementId:number;actualOpeningIssuerDate:string;observedBillings:ProofBilling[];sumObservedBillingsMinor:number;receiptPrincipalLessObservedBillingsMinor:number};
export type ReceiptPrincipalProof={sourceDatabaseSha256Before:string;sourceDatabaseSha256After:string;readOnly:boolean;asOfIssuerDate:string;currency:string;supportedReceiptPrincipalRemainderMinor:number;issuerFutureScheduleMinor:number;unallocatedAggregateRemainderMinor:number;completeFuturePrincipalKnown:boolean;receiptEvidence:ProofReceipt[]};
export type SupportedOpeningComponent={legacyReceiptId:number;cardId:string;currency:"ARS";openingDate:string;originalPrincipalMinor:number;alreadyBilledMinor:number;remainingMinor:number;purchaseDate:string;lastBilledInstallment:number;installmentCount:number;legacyTransactionIds:number[];evidencePaths:string[]};
export type DerivedOpeningProof={components:SupportedOpeningComponent[];openings:{cardId:string;currency:"ARS";observationDate:string;billedMinor:number;unbilledMinor:number;evidencePaths:string[]}[];supportedUnbilledMinor:number;futureAggregateMinor:number;unsupportedFutureRemainderMinor:number;completeFuturePrincipalKnown:false};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function minor(n:unknown):number {if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0)throw Error("invalid_receipt_principal_proof");return n;}
export function deriveOpeningProof(input:{bytes:Buffer;sourceRoot:string;rows:Row[];assignedCards:Map<string,string>;cutoffDate:string}):DerivedOpeningProof {
 const proof=JSON.parse(input.bytes.toString()) as ReceiptPrincipalProof,root=fs.realpathSync(input.sourceRoot);
 const sourceFile=(name:string):Buffer=>{if(path.isAbsolute(name)||name.split(/[\\/]/).includes(".."))throw Error("opening_proof_path_outside_source");const target=fs.realpathSync(path.join(root,name));if(!target.startsWith(`${root}${path.sep}`))throw Error("opening_proof_path_outside_source");return fs.readFileSync(target);};
 const databaseSha=sha(sourceFile("data/app.db"));
 if(proof.sourceDatabaseSha256Before!==databaseSha||proof.sourceDatabaseSha256After!==databaseSha||proof.readOnly!==true||proof.currency!=="ARS"||!Array.isArray(proof.receiptEvidence))throw Error("opening_proof_source_mismatch");
 const select=(table:string)=>input.rows.filter(r=>r.table===table),statements=select("statements"),components:SupportedOpeningComponent[]=[];
 const receiptIds=new Set<number>();
 for(const receipt of proof.receiptEvidence) {
  if(receiptIds.has(receipt.legacyReceiptId))throw Error("opening_proof_duplicate_receipt");receiptIds.add(receipt.legacyReceiptId);
  const source=select("receipts").find(r=>r.payload.id===receipt.legacyReceiptId),link=select("receipt_charge_links").find(r=>r.payload.receipt_id===receipt.legacyReceiptId);
  if(!source||!link||link.payload.fingerprint!==receipt.acceptedLegacyAssociationFingerprint||source.payload.file_sha256!==receipt.receiptPdfSha256||sha(sourceFile(receipt.receiptPdfPath))!==receipt.receiptPdfSha256||source.payload.total_cents!==minor(receipt.receiptFullPrincipalMinor)||source.payload.date!==receipt.receiptDate||receipt.receiptVerificationOk!==true||!validDate(receipt.receiptDate))throw Error("opening_proof_receipt_mismatch");
  const latest=statements.filter(s=>input.assignedCards.get(String(s.payload.file))===receipt.cardId&&String(s.payload.closing_date)<=input.cutoffDate).sort((a,b)=>String(b.payload.closing_date).localeCompare(String(a.payload.closing_date)))[0];
  if(!latest||latest.payload.id!==receipt.actualOpeningIssuerStatementId||latest.payload.closing_date!==receipt.actualOpeningIssuerDate)throw Error("opening_proof_issuer_date_mismatch");
  if(!receipt.observedBillings.length)throw Error("opening_proof_missing_billings");
  const txIds=new Set<number>(),numbers=new Set<number>();let billed=0;
  for(const observed of receipt.observedBillings) {
   if(txIds.has(observed.legacyTransactionId))throw Error("opening_proof_duplicate_billing");txIds.add(observed.legacyTransactionId);
   const transaction=select("transactions").find(t=>t.payload.id===observed.legacyTransactionId),statement=statements.find(s=>s.payload.id===observed.statementId);
   if(!transaction||!statement||transaction.payload.statement_id!==observed.statementId||transaction.payload.fingerprint!==observed.fingerprint||input.assignedCards.get(String(statement.payload.file))!==receipt.cardId||statement.payload.closing_date!==observed.issuerClosingDate||String(statement.payload.closing_date)>receipt.actualOpeningIssuerDate||transaction.payload.section!=="purchases"||transaction.payload.date!==observed.purchaseDate||observed.purchaseDate!==receipt.receiptDate||observed.currency!=="ARS"||Number(transaction.payload.usd??0)!==0||sourceAmountMinor(Number(transaction.payload.ars))!==minor(observed.actualBilledMinor)||transaction.payload.installment_number!==observed.installmentNumber||transaction.payload.installment_count!==observed.installmentCount)throw Error("opening_proof_billing_mismatch");
   const rawBytes=sourceFile(observed.rawJsonPath);if(sha(rawBytes)!==observed.rawJsonSha256)throw Error("opening_proof_json_hash_mismatch");
   const raw=JSON.parse(rawBytes.toString()) as {transactions:Record<string,unknown>[]};const printed=raw.transactions?.[observed.rawTransactionOrdinal-1];
   if(!Number.isSafeInteger(observed.rawTransactionOrdinal)||observed.rawTransactionOrdinal<1||!printed||String(printed.voucher)!==observed.voucher||["section","date","description","ars","usd","installment_number","installment_count"].some(k=>(transaction.payload[k]??null)!==(printed[k]??null)))throw Error("opening_proof_printed_line_mismatch");
   const number=observed.installmentNumber??1;if(numbers.has(number))throw Error("opening_proof_duplicate_installment");numbers.add(number);
   billed+=observed.actualBilledMinor;minor(billed);
  }
  if(!receipt.observedBillings.some(b=>b.fingerprint===receipt.acceptedLegacyAssociationFingerprint)||billed!==minor(receipt.sumObservedBillingsMinor)||receipt.receiptFullPrincipalMinor-billed!==minor(receipt.receiptPrincipalLessObservedBillingsMinor))throw Error("opening_proof_remainder_mismatch");
  const remaining=receipt.receiptPrincipalLessObservedBillingsMinor;if(!remaining)continue;
  const last=Math.max(...numbers),count=receipt.observedBillings[0].installmentCount;
  if(!count||count<=last||receipt.observedBillings.some(b=>b.installmentCount!==count)||Array.from({length:last},(_,i)=>i+1).some(n=>!numbers.has(n)))throw Error("opening_proof_installment_boundary_mismatch");
  components.push({legacyReceiptId:receipt.legacyReceiptId,cardId:receipt.cardId,currency:"ARS",openingDate:receipt.actualOpeningIssuerDate,originalPrincipalMinor:receipt.receiptFullPrincipalMinor,alreadyBilledMinor:billed,remainingMinor:remaining,purchaseDate:receipt.receiptDate,lastBilledInstallment:last,installmentCount:count,legacyTransactionIds:[...txIds],evidencePaths:[receipt.receiptPdfPath,...new Set(receipt.observedBillings.map(b=>b.rawJsonPath))]});
 }
 const supported=components.reduce((sum,c)=>sum+c.remainingMinor,0);minor(supported);
 if(supported!==minor(proof.supportedReceiptPrincipalRemainderMinor)||proof.completeFuturePrincipalKnown!==false)throw Error("opening_proof_supported_total_mismatch");
 const openings:DerivedOpeningProof["openings"]=[];let aggregate=0;
 for(const cardId of new Set(components.map(c=>c.cardId))) {
  const parts=components.filter(c=>c.cardId===cardId),date=parts[0].openingDate;
  if(parts.some(c=>c.openingDate!==date))throw Error("opening_proof_issuer_date_mismatch");
  const latest=statements.find(s=>input.assignedCards.get(String(s.payload.file))===cardId&&s.payload.closing_date===date)!;
  const future=select("upcoming_installments").filter(r=>r.payload.statement_id===latest.payload.id).reduce((sum,r)=>sum+sourceAmountMinor(Number(r.payload.amount_ars)),0);aggregate+=future;
  openings.push({cardId,currency:"ARS",observationDate:date,billedMinor:sourceAmountMinor(Number(latest.payload.balance_ars)),unbilledMinor:parts.reduce((sum,c)=>sum+c.remainingMinor,0),evidencePaths:["data/app.db",...new Set(parts.flatMap(c=>c.evidencePaths))]});
 }
 if(aggregate!==minor(proof.issuerFutureScheduleMinor)||aggregate-supported!==minor(proof.unallocatedAggregateRemainderMinor))throw Error("opening_proof_future_total_mismatch");
 return {components,openings,supportedUnbilledMinor:supported,futureAggregateMinor:aggregate,unsupportedFutureRemainderMinor:aggregate-supported,completeFuturePrincipalKnown:false};
}
